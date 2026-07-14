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
