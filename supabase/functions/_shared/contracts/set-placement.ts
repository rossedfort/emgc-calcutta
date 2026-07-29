// See ../../set-placement/index.ts — Admin/Owner submits the full desired
// results for a tournament in one call (spec 4.8/5). This is a bulk,
// full-replace endpoint, not a single-player one: any payout_structure
// place *not* present in `placements` is treated as intentionally vacant,
// and whichever player currently holds it gets cleared. This lets a
// reassignment ("move 1st from player A to player B") resolve inside one
// server-side call — vacate A's spot, then assign B — rather than
// requiring the caller to sequence two separate requests around a
// transient uniqueness conflict.
// entryId (Phase 11, renamed from playerId): a player_entries.id — a
// placement/payout belongs to one specific division's sellable unit, not
// the golfer's identity row directly (the same distinction place-bid's
// entryId makes).
export interface SetPlacementEntry {
  entryId: string;
  placement: number;
}

export interface SetPlacementRequest {
  tournamentId: string;
  placements: SetPlacementEntry[];
}

export interface SetPlacementResultEntry {
  entryId: string;
  placement: number;
  // One row normally; two (buyer + golfer) if this entry has an accepted
  // stake_buybacks row (Phase 14) — bidder_id distinguishes which row
  // belongs to whom, since it's no longer implied by "the only row".
  payouts: {
    id: string;
    bidder_id: string;
    pot_share: number;
    amount: number;
    calculated_at: string;
  }[];
}

export interface SetPlacementResponse {
  results: SetPlacementResultEntry[];
  // entryIds whose placement was cleared because their old spot isn't
  // held by them in this submission (either vacated entirely or handed
  // to a different entry).
  cleared: string[];
}
