// See ../../respond-stake-buyback/index.ts — the winning bidder accepts
// or rejects a golfer's stake buy-back request (Phase 14). Self-service
// (auth: "user"): the caller must be the buyer on the targeted
// stake_buybacks row, not an Admin acting on their behalf.
export interface RespondStakeBuybackRequest {
  entryId: string;
  decision: "accept" | "reject";
}

export interface RespondStakeBuybackResponse {
  stakeBuyback: {
    id: string;
    status: "accepted" | "rejected";
  };
  // Only set when accepting an entry that's already been placed (a
  // Payout already existed for it) — the recomputed buyer/golfer split.
  // Null when accepting an entry that hasn't been placed yet (nothing to
  // recompute yet; the next set-placement call already accounts for this
  // accepted buy-back) or when rejecting.
  payouts:
    | {
      id: string;
      bidder_id: string;
      pot_share: number;
      amount: number;
      calculated_at: string;
    }[]
    | null;
}
