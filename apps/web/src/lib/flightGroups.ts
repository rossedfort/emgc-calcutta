// Shared by EnterResultsModal.svelte and the results page (Phase 7.5):
// one placement/results group per (flight, division) combination, in
// tournaments.flights order. The Championship flight (if set) expands
// into two groups instead of one, since its players are auctioned and
// placed separately for Gross and Net. A tournament with no flights
// configured yet still gets exactly one implicit group (flight ''),
// matching this codebase's "no flight assigned" convention, rather than
// producing zero groups.
export interface FlightDivisionGroup {
	flight: string;
	division: 'overall' | 'gross' | 'net';
	label: string;
}

export function deriveFlightDivisionGroups(
	flights: string[],
	championshipFlight: string | null
): FlightDivisionGroup[] {
	const flightList = flights.length > 0 ? flights : [''];
	const groups: FlightDivisionGroup[] = [];
	for (const flight of flightList) {
		if (championshipFlight && flight === championshipFlight) {
			groups.push({ flight, division: 'gross', label: `${flight} — Gross` });
			groups.push({ flight, division: 'net', label: `${flight} — Net` });
		} else {
			groups.push({
				flight,
				division: 'overall',
				label: flight === '' ? 'All players' : flight
			});
		}
	}
	return groups;
}

// Shared by every "list of players in a tournament" view (admin/participant
// players lists, silent auction board — Phase 7.5): one row-group per
// configured flight, in tournaments.flights order, plus a trailing
// "Unassigned" group for any player whose flight hasn't been set yet
// (flight ''). An unflighted tournament (flights: []) collapses to a single
// implicit group covering every player, matching this codebase's "no flight
// assigned" convention (see deriveFlightDivisionGroups above) rather than
// showing zero groups or an "Unassigned" heading over the whole roster.
export interface FlightGroup {
	flight: string;
	label: string;
}

export function deriveFlightGroups(flights: string[]): FlightGroup[] {
	if (flights.length === 0) {
		return [{ flight: '', label: 'All players' }];
	}
	return [
		...flights.map((flight) => ({ flight, label: flight })),
		{ flight: '', label: 'Unassigned' }
	];
}

export interface FlightPlayerGroup<T> {
	group: FlightGroup;
	players: T[];
}

// Buckets an already-fetched, already-filtered player list into
// deriveFlightGroups() order and sorts each bucket by handicap index
// ascending (nulls last — an unrecorded handicap isn't "lowest", it's
// unknown). Empty groups are dropped rather than rendered as a heading over
// nothing, same precedent as the results page's per-group skip.
export function groupPlayersByFlight<T extends { flight: string; handicap_index: number | null }>(
	players: T[],
	flights: string[]
): FlightPlayerGroup<T>[] {
	return deriveFlightGroups(flights)
		.map((group) => ({
			group,
			players: players
				.filter((p) => p.flight === group.flight)
				.sort((a, b) => {
					if (a.handicap_index === null) return b.handicap_index === null ? 0 : 1;
					if (b.handicap_index === null) return -1;
					return a.handicap_index - b.handicap_index;
				})
		}))
		.filter((g) => g.players.length > 0);
}
