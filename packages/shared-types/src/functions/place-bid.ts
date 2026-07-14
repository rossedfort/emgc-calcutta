import type { Enums } from '../database';

// See supabase/functions/place-bid/index.ts for the full validation
// sequence (role, phase-open, roster membership, idempotency, increment).
export interface PlaceBidRequest {
	playerId: string;
	amount: number;
}

export interface PlaceBidResponse {
	bid: {
		id: string;
		amount: number;
		phase: Enums<'bid_phase'>;
		placed_at: string;
	};
	/** True when this bid crossed the tournament's threshold_amount, flipping the player to "reserved". */
	reserved: boolean;
}
