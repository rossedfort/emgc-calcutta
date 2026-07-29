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
  // An optional personal note from the requesting golfer, sent as part of
  // the automated stake_buyback_requested email alongside the pre-baked
  // "X wants to buy back Y% for $Z" copy — trimmed and length-capped
  // server-side (see request-stake-buyback/index.ts), never rendered as
  // raw HTML (dispatch-notification's emailParagraph/emailQuote escape
  // it same as everything else in these templates).
  message?: string | null;
}

export interface RequestStakeBuybackResponse {
  stakeBuyback: {
    id: string;
    status: "pending";
    percentage: number;
    amount: number;
  };
}
