// See ../../mark-bid-paid/index.ts — Admin confirms, outside the app,
// that a winning bidder settled their side of a sold entry (spec 4.8/5).
// Recording only, never payment processing (spec 2, Non-Goals).
//
// entryId (Phase 11, renamed from playerId): buyer_marked_paid_at/by now
// live on player_entries, not players — a Championship golfer's Gross
// and Net entries are marked paid independently.
export interface MarkBidPaidRequest {
  entryId: string;
}

export interface MarkBidPaidResponse {
  entry: {
    id: string;
    buyer_marked_paid_at: string;
    buyer_marked_paid_by: string;
  };
}
