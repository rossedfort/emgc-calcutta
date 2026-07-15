// See ../../set-placement/index.ts — Admin/Owner sets a sold Player's
// finishing placement, which automatically computes and writes (or
// recalculates) that player's winning bidder's Payout (spec 4.8/5).
export interface SetPlacementRequest {
  playerId: string;
  placement: number;
}

export interface SetPlacementResponse {
  player: {
    id: string;
    placement: number;
  };
  payout: {
    id: string;
    placement: number;
    pot_share: number;
    amount: number;
    calculated_at: string;
  };
}
