// See ../../request-stake-buyback/index.ts — a golfer requests buying
// back a percentage of their own stake from the winning bidder (Phase
// 14). Self-service (auth: "user"): the caller must be the entry's own
// linked golfer (players.user_id), not an Admin acting on their behalf.
//
// amount is deliberately NOT client-supplied — the server computes it
// from the caller's own percentage and the entry's winning_bid.amount,
// the same "server computes the money math, the client never gets to
// assert it" posture set-placement already established for
// Payout.amount. percentage itself IS client-supplied as of Phase 33
// (previously always read from tournament.buy_back_percentage) — the
// server still authoritatively decides the *outcome* (validates the
// bound, and whether it clears the tournament's auto-approval ceiling),
// it just no longer dictates the one value every request had to use.
export interface RequestStakeBuybackRequest {
  entryId: string;
  // Fraction, matching stake_buybacks.percentage's own check constraint
  // (> 0 and < 1) and tournaments.buy_back_percentage's identical bound —
  // a UI typically collects this as a whole number (e.g. "35") and
  // divides by 100 before sending, same convention the tournament
  // settings form already uses for buy_back_percentage itself.
  percentage: number;
  // An optional personal note from the requesting golfer, sent as part of
  // the automated stake_buyback_requested email alongside the pre-baked
  // "X wants to buy back Y% for $Z" copy — trimmed and length-capped
  // server-side (see request-stake-buyback/index.ts), never rendered as
  // raw HTML (dispatch-notification's emailParagraph/emailQuote escape
  // it same as everything else in these templates). Not sent at all for
  // an auto-approved request, since no stake_buyback_requested email
  // (the only one that renders it) ever goes out for that outcome.
  message?: string | null;
}

export interface RequestStakeBuybackResponse {
  stakeBuyback: {
    id: string;
    status: "pending" | "accepted";
    percentage: number;
    amount: number;
    // True when status is "accepted" because the requested percentage
    // cleared the tournament's auto-approval ceiling, not because a
    // buyer manually accepted it — always false when status is
    // "pending". Lets the UI branch its confirmation messaging on the
    // actual outcome instead of just checking status.
    autoApproved: boolean;
  };
}
