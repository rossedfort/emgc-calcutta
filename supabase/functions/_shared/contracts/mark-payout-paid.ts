// See ../../mark-payout-paid/index.ts — Admin confirms, outside the app,
// that a placement winner was handed their share of the pot (spec 4.8/5).
// Same pattern as mark-bid-paid, opposite money direction: recording
// only, never payment processing (spec 2, Non-Goals).
export interface MarkPayoutPaidRequest {
  payoutId: string;
}

export interface MarkPayoutPaidResponse {
  payout: {
    id: string;
    marked_paid_at: string;
    marked_paid_by: string;
  };
}
