import type { Enums } from "../database.ts";

// See ../../place-bid/index.ts for the full validation sequence (role,
// phase-open, roster membership, idempotency, increment).
//
// entryId (Phase 11, renamed from playerId): a player_entries.id, not a
// players.id — a bid always targets one specific division's sellable
// unit, never the golfer's identity row directly.
//
// bidderId (Phase 32): a users.id to place this bid on behalf of, for the
// admin "Place bids" screen — in-person silent/live auction bidding for
// participants who aren't submitting it themselves. Only honored when the
// caller's own role is admin/owner; see place-bid/index.ts for the
// rejection behavior otherwise. Omitted (the default) means "place this as
// me," unchanged from before this field existed.
export interface PlaceBidRequest {
  entryId: string;
  amount: number;
  bidderId?: string;
}

export interface PlaceBidResponse {
  bid: {
    id: string;
    amount: number;
    phase: Enums<"bid_phase">;
    placed_at: string;
    bidder_id: string;
    placed_by_admin_id: string | null;
  };
  /** True when this bid crossed the tournament's threshold_amount, flipping the player to "reserved". */
  reserved: boolean;
}
