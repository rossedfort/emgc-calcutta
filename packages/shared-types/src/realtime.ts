import type { Enums } from './database';

// Payload shapes broadcast over the per-tournament Realtime channel (spec
// 4.5) — the single source of truth for both the store that subscribes to
// them (apps/web/src/lib/stores/realtime.ts) and anything else that needs
// to describe the same wire shape. Deliberately narrower than the full
// generated Row types: the channel only ever needs to carry what a
// connected client can't otherwise get from its own SSR-loaded snapshot.
export interface RealtimeBid {
	id: string;
	player_id: string;
	bidder_id: string;
	amount: number;
	phase: Enums<'bid_phase'>;
	placed_at: string;
	voided_at: string | null;
}

export interface RealtimePlayer {
	id: string;
	status: Enums<'player_status'>;
}

// Unlike RealtimeBid/RealtimePlayer, this carries every live_lots column —
// the live auction screen needs opened_at/closed_at to find the current
// lot, closes_at for the anti-snipe countdown, and winning_bid_id for the
// eventual sold display, so there's nothing left to narrow.
export interface RealtimeLiveLot {
	id: string;
	player_id: string;
	queue_position: number;
	opened_at: string | null;
	closed_at: string | null;
	closes_at: string | null;
	winning_bid_id: string | null;
}
