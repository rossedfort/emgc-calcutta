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

// Splits a formatted amount ("$1,850.00") into characters for the
// SlotMachineDigit spin-on-change effect, each keyed by distance from the
// *end* of the string rather than the start — bid amounts only ever grow (a
// bid must beat the current high), so a new leading digit appearing (e.g.
// "$99.00" -> "$100.00") only ever prepends a character; keying from the
// right means the existing trailing digits' SlotMachineDigit instances (and
// the mid-spin state they're holding) keep their identity instead of every
// position remapping to a different character.
export function currencyChars(
	formatted: string
): { char: string; isDigit: boolean; key: number }[] {
	const chars = formatted.split('');
	return chars.map((char, i) => ({
		char,
		isDigit: char >= '0' && char <= '9',
		key: chars.length - 1 - i
	}));
}
