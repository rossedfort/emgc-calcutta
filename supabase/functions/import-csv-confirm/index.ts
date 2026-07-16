// Writes the rows an Admin has reviewed and confirmed from the
// import-csv-preview payload — this is the commit step (spec 4.2); the
// Admin may have overridden or cleared the auto-matched userId per row
// before calling this. All rows are written in a single multi-row insert,
// which Postgres executes as one atomic statement — if any row violates a
// constraint, the whole batch rolls back, matching "transactionally" in the
// backlog without needing an explicit BEGIN/COMMIT.
//
// Logs one AuditEvent for the whole batch (Phase 5's review pass), not
// one per imported player — this is a single admin action even though it
// writes many rows, and a summary event (with every created player's id
// in `after`) is more useful for dispute resolution than N near-identical
// log lines.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import type {
  ImportCsvConfirmRequest,
  ImportCsvConfirmResponse,
} from "../_shared/contracts/import-csv-confirm.ts";

export default {
  fetch: withSupabase<Database>(
    { auth: "user", env: resolveSupabaseEnv() },
    async (req, ctx) => {
      const { data: caller, error: callerError } = await ctx.supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", ctx.userClaims!.id)
        .single();
      if (callerError) {
        return Response.json({ error: callerError.message }, { status: 500 });
      }
      if (!isAdminOrOwner(caller.role)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      const body = await req.json().catch(() => null) as
        | Partial<ImportCsvConfirmRequest>
        | null;
      if (!body?.tournamentId || !Array.isArray(body.rows)) {
        return Response.json(
          { error: "tournamentId and rows are required" },
          { status: 400 },
        );
      }
      if (body.rows.length === 0) {
        return Response.json({ error: "rows must not be empty" }, {
          status: 400,
        });
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select("id, championship_flight")
        .eq("id", body.tournamentId)
        .maybeSingle();
      if (tournamentError) {
        return Response.json({ error: tournamentError.message }, {
          status: 500,
        });
      }
      if (!tournament) {
        return Response.json({ error: "Tournament not found" }, {
          status: 404,
        });
      }

      // Authoritative re-check, not just trusting the preview step's
      // client-visible validation (same reasoning as parseTournamentForm).
      const rowErrors: string[] = [];
      body.rows.forEach((row, index) => {
        if (!row.name?.trim()) {
          rowErrors.push(`Row ${index + 1}: name is required`);
        }
      });
      if (rowErrors.length > 0) {
        return Response.json({ error: rowErrors.join("; ") }, {
          status: 400,
        });
      }

      // A roster row whose flight is the tournament's Championship flight
      // becomes *two* players rows — one per division — since that flight's
      // golfers are auctioned separately for Gross and Net (Phase 7.5).
      // Every other row stays a single 'overall' row, unchanged. A linked
      // userId is carried onto both Championship rows (confirmed decision):
      // the relaxed (tournament_id, user_id, division) uniqueness (see this
      // task's own migration) is exactly what makes that possible without
      // colliding with the Gross/Net counterpart.
      const insertRows = body.rows.flatMap((row) => {
        const base = {
          tournament_id: body.tournamentId!,
          name: row.name!.trim(),
          contact_email: row.contact_email || null,
          contact_phone: row.contact_phone || null,
          // '' (not null) — players.flight is not-null-default-'' as of the
          // flighting schema task; a raw `|| null` here would violate that
          // constraint for any row with no flight in the CSV.
          flight: row.flight || "",
          handicap_index: row.handicap_index ?? null,
          preferences: row.preferences || null,
          photo_url: row.photo_url || null,
          user_id: row.userId || null,
        };

        if (
          tournament.championship_flight &&
          row.flight === tournament.championship_flight
        ) {
          return [
            { ...base, division: "gross" },
            { ...base, division: "net" },
          ];
        }
        return [{ ...base, division: "overall" }];
      });

      const { data, error: insertError } = await ctx.supabaseAdmin
        .from("players")
        .insert(insertRows)
        .select("id, slug, name");
      if (insertError) {
        // Most likely cause: one of these rows' userId is already linked to
        // a different player in this tournament (unique per (tournamentId,
        // userId) — see the players migration) — e.g. re-importing a CSV
        // where a row auto-matched to someone already linked from an
        // earlier import. Translate rather than surfacing Postgres's raw
        // constraint-name error.
        const message = insertError.code === "23505"
          ? "One of these rows is linked to a participant who's already linked to another player in this tournament. Uncheck that row's link (or exclude the row) and try again."
          : insertError.message;
        return Response.json({ error: message }, {
          status: 400,
        });
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: body.tournamentId,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "csv_import",
        entity_type: "CSVImport",
        after: { count: data.length, players: data },
        ip,
        user_agent,
      });

      return Response.json(
        {
          count: data.length,
          players: data,
        } satisfies ImportCsvConfirmResponse,
      );
    },
  ),
};
