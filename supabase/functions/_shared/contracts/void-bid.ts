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
}
