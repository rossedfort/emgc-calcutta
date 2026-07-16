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
