import type { RealtimeBid } from '$lib/stores/realtime';

// Colocated with the Bid domain, following the same pattern as
// playerStatusBadgeVariant in $lib/players.ts. The current high bid for a
// player is just the highest non-voided bid, computed client-side from
// whatever bid list the caller already has (the Realtime store's live feed).
export function currentHighBid(bids: RealtimeBid[], playerId: string): RealtimeBid | null {
	return bids
		.filter((bid) => bid.player_id === playerId && !bid.voided_at)
		.reduce<RealtimeBid | null>(
			(high, bid) => (!high || bid.amount > high.amount ? bid : high),
			null
		);
}
