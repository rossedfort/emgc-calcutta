// Shared by every state-changing Edge Function that logs an AuditEvent
// (spec 4.6, 6.5), so the write shape stays consistent in one place
// instead of being hand-rolled N times. Scoped to Edge Functions only —
// the Postgres RPC functions (open_live_lot, close_live_lot,
// swap_queue_position, resequence_queue, start_live_auction,
// enqueue_player_for_live_auction) are all SECURITY INVOKER and run with
// the caller's own privileges, which can't write to audit_events at all
// (it has zero client-writable policies, by design — see the
// create_audit_events migration). Auditing those would need a narrowly-
// scoped SECURITY DEFINER helper (a new pattern, not used anywhere in
// this codebase yet) — flagged as a Phase 9 follow-up rather than solved
// here, since this backlog line's own wording scopes it to "every Edge
// Function," not every state-changing action.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.ts";

export interface AuditEventInput {
  tournament_id?: string | null;
  player_id?: string | null;
  actor_id?: string | null;
  actor_identity?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  before?: Json | null;
  after?: Json | null;
  reason?: string | null;
  ip?: string | null;
  user_agent?: string | null;
}

// Awaited (not fire-and-forget) so the write is guaranteed to happen
// before the function returns — Deno Edge Function isolates aren't
// guaranteed to keep running background work after the response is sent
// unless it's explicitly handed to EdgeRuntime.waitUntil(), and this is
// meant to be a reliable trail, not best-effort.
//
// A failed audit write is logged to stderr but does NOT fail the
// request or roll back the action it's describing — same reasoning spec
// 4.7 already applies to notification failures ("logged, not blocking"):
// the underlying bid/vote/role-change already succeeded and committed,
// and failing the whole request after the fact would be a worse outcome
// than a missing log line.
export async function logAuditEvent(
  supabaseAdmin: SupabaseClient<Database>,
  event: AuditEventInput,
): Promise<void> {
  const { error } = await supabaseAdmin.from("audit_events").insert({
    tournament_id: event.tournament_id ?? null,
    player_id: event.player_id ?? null,
    actor_id: event.actor_id ?? null,
    actor_identity: event.actor_identity ?? null,
    action: event.action,
    entity_type: event.entity_type,
    entity_id: event.entity_id ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
    reason: event.reason ?? null,
    ip: event.ip ?? null,
    user_agent: event.user_agent ?? null,
  });
  if (error) {
    console.error(
      `Failed to write audit event (action=${event.action}):`,
      error.message,
    );
  }
}

// Extracts client IP and user agent the same way for every function that
// logs an event, rather than re-deriving it inline each time.
export function requestMetadata(
  req: Request,
): { ip: string | null; user_agent: string | null } {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ?? null;
  return { ip, user_agent: req.headers.get("user-agent") };
}
