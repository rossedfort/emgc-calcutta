import type { RealtimeBid } from '@emgc-calcutta/shared-types';

// Colocated with the Bid domain, following the same pattern as
// playerStatusBadgeVariant in $lib/players.ts. The current high bid for an
// entry is just the highest non-voided bid, computed client-side from
// whatever bid list the caller already has (the Realtime store's live feed).
// entryId (Phase 11, renamed from playerId): a player_entries.id, matching
// bids.entry_id.
export function currentHighBid(bids: RealtimeBid[], entryId: string): RealtimeBid | null {
	return bids
		.filter((bid) => bid.entry_id === entryId && !bid.voided_at)
		.reduce<RealtimeBid | null>(
			(high, bid) => (!high || bid.amount > high.amount ? bid : high),
			null
		);
}
