// See ../../delete-tournament/index.ts — Owner/Admin deletes a tournament
// (Phase 17, not in the original spec; the spec's role table lists this as
// Owner-only, broadened to Owner-or-Admin at the user's explicit request).
// Restricted to kind='dry_run' tournaments only — a production tournament's
// history is never deletable, matching spec 7's "no hard deletes in the
// bidding/audit path" for real auction data.
export interface DeleteTournamentRequest {
  tournamentId: string;
}

export interface DeleteTournamentResponse {
  deleted: true;
}
