// See ../../request-stake-buyback/index.ts — a golfer requests buying
// back a percentage of their own stake from the winning bidder (Phase
// 14). Self-service (auth: "user"): the caller must be the entry's own
// linked golfer (players.user_id), not an Admin acting on their behalf.
//
// percentage/amount are deliberately NOT client-supplied — the server
// computes both from tournament.buy_back_percentage and the entry's own
// winning_bid.amount, the same "server computes the money math, the
// client never gets to assert it" posture set-placement already
// established for Payout.amount.
export interface RequestStakeBuybackRequest {
  entryId: string;
}

export interface RequestStakeBuybackResponse {
  stakeBuyback: {
    id: string;
    status: "pending";
    percentage: number;
    amount: number;
  };
}
