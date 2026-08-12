// See ../../void-bid/index.ts — Admin voids a bid with a required reason
// (spec 7: voids are soft, logged, and reversible by an Owner, never a
// hard delete).
export interface VoidBidRequest {
  bidId: string;
  reason: string;
}

export interface VoidBidResponse {
  bid: {
    id: string;
    voided_at: string;
    void_reason: string;
  };
  // True when the voided bid was the winning_bid_id of an already-closed
  // live lot — the confirmed behavior for that case is to recompute the
  // winner from the next-highest surviving bid immediately, not reopen
  // the lot for further bidding.
  recomputed: boolean;
  // The entry's new winning bid after recompute — null if recomputed is
  // false, or if recomputed is true but no surviving bid remained (the
  // entry falls back to "no_bid"). Phase 36: enough detail for the caller
  // to build a "winner recomputed" message without a follow-up lookup —
  // this is deliberately not scoped to phase 'live', since the recompute
  // itself considers every surviving bid on the entry regardless of which
  // phase placed it (an earlier silent-phase bid can end up the new
  // winner of what was a live lot).
  new_winning_bid: {
    id: string;
    amount: number;
    bidder_name: string | null;
  } | null;
}
