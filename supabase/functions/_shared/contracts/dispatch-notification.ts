// See ../../dispatch-notification/index.ts — sends a single notification
// email via Resend (spec 4.7, email-only per the Phase 6 deviation) and
// logs the outcome. Invoked internally (Database Webhooks / Postgres
// trigger logic, later backlog tasks), not by end users — the caller
// already knows *who* to notify and *why* (that's their job: querying
// current-high-bid, Player.userId, tournament roster, etc.), this
// function's job is only "send it, and log what happened."
export type NotificationTrigger =
  | "outbid"
  | "bid_on_you"
  | "reserved"
  | "live_starting"
  | "won";

export interface DispatchNotificationRequest {
  userId: string;
  trigger: NotificationTrigger;
  tournamentId: string;
  // Every trigger except live_starting (tournament-wide, not about any
  // one player) is about a specific Player.
  playerId?: string;
  // outbid/won carry the bid amount that triggered them.
  amount?: number;
}

export interface DispatchNotificationResponse {
  // False for a handled, non-exceptional skip (e.g. opted out) or a
  // failed send — spec 4.7: "failed sends are logged, not retried
  // indefinitely, and don't block the real-time broadcast or UI update",
  // so a failure here is a normal response, not an HTTP error.
  sent: boolean;
}
