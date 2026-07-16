// See ../../set-placement/index.ts — Admin/Owner submits the full desired
// results for a tournament in one call (spec 4.8/5). This is a bulk,
// full-replace endpoint, not a single-player one: any payout_structure
// place *not* present in `placements` is treated as intentionally vacant,
// and whichever player currently holds it gets cleared. This lets a
// reassignment ("move 1st from player A to player B") resolve inside one
// server-side call — vacate A's spot, then assign B — rather than
// requiring the caller to sequence two separate requests around a
// transient uniqueness conflict.
export interface SetPlacementEntry {
  playerId: string;
  placement: number;
}

export interface SetPlacementRequest {
  tournamentId: string;
  placements: SetPlacementEntry[];
}

export interface SetPlacementResultEntry {
  playerId: string;
  placement: number;
  payout: {
    id: string;
    pot_share: number;
    amount: number;
    calculated_at: string;
  };
}

export interface SetPlacementResponse {
  results: SetPlacementResultEntry[];
  // playerIds whose placement was cleared because their old spot isn't
  // held by them in this submission (either vacated entirely or handed
  // to a different player).
  cleared: string[];
}
