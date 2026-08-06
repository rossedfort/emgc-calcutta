// Owner/Admin deletes a tournament outright (Phase 17, not in the original
// spec — user-requested). The spec's role table (section 3) lists "delete
// tournament data" as Owner-only; broadened to Owner-or-Admin here at the
// user's explicit request, a confirmed deviation, not an oversight.
//
// Restricted to kind='dry_run' only, re-checked here even though
// delete_tournament_cascade (the migration this calls) also guards it —
// defense in depth, and it lets this return a clean 400 instead of
// surfacing a raw Postgres exception. A dry_run tournament is a disposable
// rehearsal (spec 6.4); a production tournament's history is never
// reachable through this function, matching spec 7's "no hard deletes in
// the bidding/audit path" for real auction data.
//
// Audit ordering is the one real deviation from every other Edge
// Function's "write first, then log" convention (see mark-bid-paid,
// void-bid, set-placement): audit_events.tournament_id is a foreign key
// (on delete set null), so it can only be set to this tournament's id
// *before* the tournament is deleted — inserting after would either fail
// outright (if attempted with the now-deleted id) or lose the reference.
// Logging first also means this deliberately does NOT use the shared
// logAuditEvent helper's fire-and-forget contract (log failure doesn't
// block the request) — a failed audit write here aborts before anything
// is deleted, since audit_events has no DELETE grant for service_role
// even in this codebase's own tooling (see CLAUDE.md's known quirks), so
// there'd be no way to retract an inaccurate "deleted" log entry after
// the fact if the cascade itself then failed. Fail-closed is the only
// option that keeps the audit trail honest.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import { requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import type {
  DeleteTournamentRequest,
  DeleteTournamentResponse,
} from "../_shared/contracts/delete-tournament.ts";

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
        | Partial<DeleteTournamentRequest>
        | null;
      if (!body?.tournamentId) {
        return Response.json({ error: "tournamentId is required" }, {
          status: 400,
        });
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select("id, name, slug, kind, status")
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
      if (tournament.kind !== "dry_run") {
        return Response.json(
          { error: "Only dry-run tournaments can be deleted" },
          { status: 400 },
        );
      }

      const { ip, user_agent } = requestMetadata(req);
      const { error: auditError } = await ctx.supabaseAdmin.from(
        "audit_events",
      ).insert({
        tournament_id: tournament.id,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "tournament_deleted",
        entity_type: "Tournament",
        entity_id: tournament.id,
        before: {
          name: tournament.name,
          slug: tournament.slug,
          kind: tournament.kind,
          status: tournament.status,
        },
        after: null,
        ip,
        user_agent,
      });
      if (auditError) {
        return Response.json({ error: auditError.message }, { status: 500 });
      }

      const { error: deleteError } = await ctx.supabaseAdmin.rpc(
        "delete_tournament_cascade",
        { p_tournament_id: tournament.id },
      );
      if (deleteError) {
        return Response.json({ error: deleteError.message }, {
          status: 500,
        });
      }

      return Response.json(
        { deleted: true } satisfies DeleteTournamentResponse,
      );
    },
  ),
};
