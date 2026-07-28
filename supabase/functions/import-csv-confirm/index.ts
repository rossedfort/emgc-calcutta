// Writes the rows an Admin has reviewed and confirmed from the
// import-csv-preview payload — this is the commit step (spec 4.2). Every
// row is written unlinked (no user_id) — self-service linking (Phase 10)
// is the only way a Player gets connected to a User.
//
// Two insert statements now (Phase 11), not one: first the `players`
// identity rows (one per CSV row, in order — Postgres preserves row order
// through a plain VALUES-list INSERT...RETURNING, which the code below
// relies on to line each returned player back up with its own row's
// flight/division), then a `flatMap`'d `player_entries` insert (one row,
// or two for a Championship-flight golfer). Each insert is still atomic on
// its own (a single multi-row INSERT either fully succeeds or fully rolls
// back), but the two together no longer share one transaction the way a
// single insert did — if the `player_entries` insert fails after the
// `players` insert already committed, that would silently leave identity
// rows with zero sellable entries (invisible everywhere entries are
// required, effectively a phantom golfer no one could ever bid on). Rather
// than reach for a Postgres function purely to restore atomicity, the
// `players` rows just inserted are explicitly deleted before returning the
// error — a compensating rollback, not a real transaction, but sufficient
// here since the only realistic failure mode at that second step is
// transient (network/connection), not a data problem: the division on
// every entry row is derived from the exact same
// `tournament.championship_flight` comparison already used for the
// `players` insert, so if that insert succeeded, the entries insert's
// data is already known-valid.
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
        if (!row.first_name?.trim()) {
          rowErrors.push(`Row ${index + 1}: first name is required`);
        }
        if (!row.last_name?.trim()) {
          rowErrors.push(`Row ${index + 1}: last name is required`);
        }
      });
      if (rowErrors.length > 0) {
        return Response.json({ error: rowErrors.join("; ") }, {
          status: 400,
        });
      }

      const insertPlayers = body.rows.map((row) => ({
        tournament_id: body.tournamentId!,
        first_name: row.first_name!.trim(),
        last_name: row.last_name!.trim(),
        // '' (not null) — players.flight is not-null-default-'' as of the
        // flighting schema task; a raw `|| null` here would violate that
        // constraint for any row with no flight in the CSV.
        flight: row.flight || "",
        handicap_index: row.handicap_index ?? null,
        preferences: row.preferences || null,
        photo_url: row.photo_url || null,
      }));

      const { data: players, error: insertError } = await ctx.supabaseAdmin
        .from("players")
        .insert(insertPlayers)
        .select("id, slug, first_name, last_name, flight");
      if (insertError) {
        return Response.json({ error: insertError.message }, {
          status: 400,
        });
      }

      // A roster row whose flight is the tournament's Championship flight
      // becomes *two* player_entries rows — one per division — since that
      // flight's golfers are auctioned separately for Gross and Net (Phase
      // 7.5, moved from `players` to `player_entries` in Phase 11). Every
      // other row stays a single 'overall' entry, unchanged.
      const insertEntries = players.flatMap((player) => {
        const base = {
          player_id: player.id,
          tournament_id: body.tournamentId!,
          flight: player.flight,
        };
        if (
          tournament.championship_flight &&
          player.flight === tournament.championship_flight
        ) {
          return [
            { ...base, division: "gross" },
            { ...base, division: "net" },
          ];
        }
        return [{ ...base, division: "overall" }];
      });

      const { error: entriesInsertError } = await ctx.supabaseAdmin
        .from("player_entries")
        .insert(insertEntries);
      if (entriesInsertError) {
        // Compensating rollback — see the header comment for why this
        // isn't a real transaction. Best-effort: if the delete itself
        // fails too, the entriesInsertError is still what's surfaced to
        // the Admin, not this secondary failure.
        await ctx.supabaseAdmin.from("players").delete().in(
          "id",
          players.map((p) => p.id),
        );
        return Response.json({ error: entriesInsertError.message }, {
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
        after: {
          count: players.length,
          players: players.map((p) => ({
            id: p.id,
            slug: p.slug,
            first_name: p.first_name,
            last_name: p.last_name,
          })),
          entryCount: insertEntries.length,
        },
        ip,
        user_agent,
      });

      return Response.json(
        {
          count: players.length,
          players: players.map((p) => ({
            id: p.id,
            slug: p.slug,
            first_name: p.first_name,
            last_name: p.last_name,
          })),
        } satisfies ImportCsvConfirmResponse,
      );
    },
  ),
};
