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
// catch-all group for anything that doesn't match a configured flight.
export interface FlightGroup {
	flight: string;
	label: string;
}

export interface FlightPlayerGroup<T> {
	group: FlightGroup;
	players: T[];
}

// Buckets an already-fetched, already-filtered player list by
// tournaments.flights order and sorts each bucket by handicap index
// ascending (nulls last — an unrecorded handicap isn't "lowest", it's
// unknown). Empty groups are dropped rather than rendered as a heading over
// nothing, same precedent as the results page's per-group skip.
//
// The catch-all "leftover" group is matched by *exclusion* (any player
// whose flight isn't one of the configured `flights`), not by an assumed
// `flight === ''`, deliberately: a player's flight can be a real,
// non-empty value that simply isn't (or isn't yet) in the tournament's
// configured list — grandfathered/seeded data from before flighting was
// configured for that tournament, for instance. Matching by exclusion means
// every player is guaranteed to land in exactly one group and none silently
// vanish; matching only `flight === ''` (an earlier version of this
// function) would have dropped every such player from the display entirely
// whenever they outnumbered the configured flights (including the common
// case of an unconfigured tournament, where `flights` is `[]` and no
// player's `flight` is `''`).
export function groupPlayersByFlight<T extends { flight: string; handicap_index: number | null }>(
	players: T[],
	flights: string[]
): FlightPlayerGroup<T>[] {
	const sortByHandicap = (list: T[]) =>
		[...list].sort((a, b) => {
			if (a.handicap_index === null) return b.handicap_index === null ? 0 : 1;
			if (b.handicap_index === null) return -1;
			return a.handicap_index - b.handicap_index;
		});

	const configured = new Set(flights);
	const groups: FlightPlayerGroup<T>[] = flights.map((flight) => ({
		group: { flight, label: flight },
		players: sortByHandicap(players.filter((p) => p.flight === flight))
	}));

	const leftover = sortByHandicap(players.filter((p) => !configured.has(p.flight)));
	groups.push({
		group: { flight: '', label: flights.length === 0 ? 'All players' : 'Unassigned' },
		players: leftover
	});

	return groups.filter((g) => g.players.length > 0);
}

// Shared by any view that needs the Championship flight's Gross/Net split
// broken into visually separate sections rather than one flight-only group
// with an inline badge (silent auction board — a participant reported real
// confusion bidding on a Championship golfer without the board making it
// obvious which of the two auction entries a given row was). Same shape as
// groupPlayersByFlight (handicap-ascending sort, empty groups dropped, a
// catch-all so a player never silently vanishes) but keyed by
// deriveFlightDivisionGroups' (flight, division) groups instead of flight
// alone — the Championship flight expands into two adjacent sections
// instead of one.
export interface FlightDivisionPlayerGroup<T> {
	group: FlightDivisionGroup;
	players: T[];
}

export function groupPlayersByFlightAndDivision<
	T extends { flight: string; division: string; handicap_index: number | null }
>(
	players: T[],
	flights: string[],
	championshipFlight: string | null
): FlightDivisionPlayerGroup<T>[] {
	const sortByHandicap = (list: T[]) =>
		[...list].sort((a, b) => {
			if (a.handicap_index === null) return b.handicap_index === null ? 0 : 1;
			if (b.handicap_index === null) return -1;
			return a.handicap_index - b.handicap_index;
		});

	const definedGroups = deriveFlightDivisionGroups(flights, championshipFlight);
	const matched = new Set<T>();
	const groups: FlightDivisionPlayerGroup<T>[] = definedGroups.map((group) => {
		const inGroup = players.filter(
			(p) => p.flight === group.flight && p.division === group.division
		);
		inGroup.forEach((p) => matched.add(p));
		return { group, players: sortByHandicap(inGroup) };
	});

	// Same "never silently drop a player" guarantee as groupPlayersByFlight's
	// own leftover group — a player whose (flight, division) doesn't match
	// any derived group (an unconfigured flight, or data predating a
	// championship_flight change) still gets shown, rather than vanishing.
	const leftover = sortByHandicap(players.filter((p) => !matched.has(p)));
	if (leftover.length > 0) {
		groups.push({
			group: { flight: '', division: 'overall', label: 'Unassigned' },
			players: leftover
		});
	}

	return groups.filter((g) => g.players.length > 0);
}
