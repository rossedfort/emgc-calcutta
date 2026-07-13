// Writes the rows an Admin has reviewed and confirmed from the
// import-csv-preview payload — this is the commit step (spec 4.2); the
// Admin may have overridden or cleared the auto-matched userId per row
// before calling this. All rows are written in a single multi-row insert,
// which Postgres executes as one atomic statement — if any row violates a
// constraint, the whole batch rolls back, matching "transactionally" in the
// backlog without needing an explicit BEGIN/COMMIT.
//
// Does NOT log an AuditEvent yet — that table doesn't exist until Phase 5,
// which explicitly includes a review pass to wire audit logging into every
// state-changing Edge Function built before it, this one included.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";

interface ConfirmedRow {
  name?: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  flight?: string | null;
  preferences?: string | null;
  photo_url?: string | null;
  userId?: string | null;
}

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
        | { tournamentId?: string; rows?: ConfirmedRow[] }
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
        .select("id")
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

      const insertRows = body.rows.map((row) => ({
        tournament_id: body.tournamentId!,
        name: row.name!.trim(),
        contact_email: row.contact_email || null,
        contact_phone: row.contact_phone || null,
        flight: row.flight || null,
        preferences: row.preferences || null,
        photo_url: row.photo_url || null,
        user_id: row.userId || null,
      }));

      const { data, error: insertError } = await ctx.supabaseAdmin
        .from("players")
        .insert(insertRows)
        .select("id, slug, name");
      if (insertError) {
        return Response.json({ error: insertError.message }, {
          status: 400,
        });
      }

      return Response.json({ count: data.length, players: data });
    },
  ),
};
