// See ../../mark-bid-paid/index.ts — Admin confirms, outside the app,
// that a winning bidder settled their side of a sold Player (spec 4.8/5).
// Recording only, never payment processing (spec 2, Non-Goals).
export interface MarkBidPaidRequest {
  playerId: string;
}

export interface MarkBidPaidResponse {
  player: {
    id: string;
    buyer_marked_paid_at: string;
    buyer_marked_paid_by: string;
  };
}
