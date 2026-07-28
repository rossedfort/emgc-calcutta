import type { Enums } from "../database.ts";

// See ../../place-bid/index.ts for the full validation sequence (role,
// phase-open, roster membership, idempotency, increment).
//
// entryId (Phase 11, renamed from playerId): a player_entries.id, not a
// players.id — a bid always targets one specific division's sellable
// unit, never the golfer's identity row directly.
export interface PlaceBidRequest {
  entryId: string;
  amount: number;
}

export interface PlaceBidResponse {
  bid: {
    id: string;
    amount: number;
    phase: Enums<"bid_phase">;
    placed_at: string;
  };
  /** True when this bid crossed the tournament's threshold_amount, flipping the player to "reserved". */
  reserved: boolean;
}
