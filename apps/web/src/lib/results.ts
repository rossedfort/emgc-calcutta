import { deriveFlightDivisionGroups, type FlightDivisionGroup } from '$lib/flightGroups';

// Shared by the admin ("enter placements") and participant ("view past
// results") results pages (Phase 15) — both group sold entries into the
// same per-(flight, division) shape and need the same split-payout-aware
// summing, but differ in what each row's winning_bid carries (the admin
// page needs a full bidder identity for contact purposes; the participant
// page only ever needs a name, via bids.bidder_name). Parameterized on the
// row shape rather than forking two near-identical copies of this logic.

export interface ResultsPayoutTotal {
	pot_share: number;
	amount: number;
}

// A split entry (Phase 14: an accepted stake buy-back) has two payout rows
// sharing an entry_id — summed into one total here rather than a plain
// last-wins Map silently dropping one row's amount. pot_share is identical
// across a split entry's rows (it's the placement's percentage, unaffected
// by the split), so the first row's value is fine to keep as-is.
export function sumPayoutsByEntryId(
	payouts: readonly { entry_id: string; pot_share: number; amount: number }[]
): Map<string, ResultsPayoutTotal> {
	const byEntryId = new Map<string, ResultsPayoutTotal>();
	for (const p of payouts) {
		const existing = byEntryId.get(p.entry_id);
		byEntryId.set(p.entry_id, {
			pot_share: p.pot_share,
			amount: (existing?.amount ?? 0) + p.amount
		});
	}
	return byEntryId;
}

// Placement ascending (1st, 2nd, 3rd... in finishing order), nulls last so
// not-yet-placed entries trail rather than scattering among placed ones;
// name is a secondary sort so the not-yet-placed group has a stable order
// across reloads instead of shuffling arbitrarily.
export function sortResultsByPlacement<
	T extends { placement: number | null; first_name: string; last_name: string }
>(rows: readonly T[]): T[] {
	return [...rows].sort((a, b) => {
		if (a.placement === null && b.placement === null) {
			return a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name);
		}
		if (a.placement === null) return 1;
		if (b.placement === null) return -1;
		return a.placement - b.placement;
	});
}

// Handicap ascending, nulls last (an unrecorded handicap isn't "lowest",
// it's unknown) — same convention groupPlayersByFlightAndDivision already
// uses for the participant-facing player lists (silent auction board).
// Used by the admin results page instead of sortResultsByPlacement: most
// rows have no placement yet while an Admin is still entering them, so
// placement order isn't a useful way to find a specific player on that
// screen the way it is on the participant-facing "final standings" view.
export function sortResultsByHandicap<
	T extends { handicap_index: number | null; first_name: string; last_name: string }
>(rows: readonly T[]): T[] {
	return [...rows].sort((a, b) => {
		if (a.handicap_index === null && b.handicap_index === null) {
			return a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name);
		}
		if (a.handicap_index === null) return 1;
		if (b.handicap_index === null) return -1;
		return a.handicap_index - b.handicap_index;
	});
}

export interface ResultsGroup<T> {
	group: FlightDivisionGroup;
	players: T[];
}

// One group per (flight, division) combination, in tournaments.flights
// order (Championship expanding into Gross/Net) — mirrors
// EnterResultsModal's own grouping. Doesn't drop a leftover group for
// unmatched rows the way groupPlayersByFlightAndDivision does: both callers
// of this helper already scope their query to sold entries within this one
// tournament, so every row is expected to match a derived group.
export function groupResultsByFlightDivision<T extends { flight: string; division: string }>(
	rows: readonly T[],
	flights: string[],
	championshipFlight: string | null
): ResultsGroup<T>[] {
	const groups = deriveFlightDivisionGroups(flights, championshipFlight);
	return groups.map((group) => ({
		group,
		players: rows.filter((p) => p.flight === group.flight && p.division === group.division)
	}));
}
