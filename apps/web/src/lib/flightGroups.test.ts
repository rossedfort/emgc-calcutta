import { describe, expect, it } from 'vitest';
import { deriveFlightDivisionGroups, groupPlayersByFlight } from './flightGroups';

interface TestPlayer {
	name: string;
	flight: string;
	handicap_index: number | null;
}

function player(name: string, flight: string, handicap_index: number | null): TestPlayer {
	return { name, flight, handicap_index };
}

describe('deriveFlightDivisionGroups', () => {
	it('returns a single "All players" group when no flights are configured', () => {
		expect(deriveFlightDivisionGroups([], null)).toEqual([
			{ flight: '', division: 'overall', label: 'All players' }
		]);
	});

	it('returns one overall group per configured flight, in configured order', () => {
		expect(deriveFlightDivisionGroups(['B', 'A'], null)).toEqual([
			{ flight: 'B', division: 'overall', label: 'B' },
			{ flight: 'A', division: 'overall', label: 'A' }
		]);
	});

	it('expands the championship flight into Gross/Net groups, leaving others overall', () => {
		expect(deriveFlightDivisionGroups(['A', 'Championship', 'B'], 'Championship')).toEqual([
			{ flight: 'A', division: 'overall', label: 'A' },
			{ flight: 'Championship', division: 'gross', label: 'Championship — Gross' },
			{ flight: 'Championship', division: 'net', label: 'Championship — Net' },
			{ flight: 'B', division: 'overall', label: 'B' }
		]);
	});
});

describe('groupPlayersByFlight', () => {
	it('buckets players into one group per configured flight, in configured order', () => {
		const players = [player('Amy', 'A', 10), player('Bob', 'B', 5), player('Cal', 'A', 3)];
		const groups = groupPlayersByFlight(players, ['A', 'B']);

		expect(groups.map((g) => g.group.flight)).toEqual(['A', 'B']);
		expect(groups[0].players.map((p) => p.name)).toEqual(['Cal', 'Amy']);
		expect(groups[1].players.map((p) => p.name)).toEqual(['Bob']);
	});

	it('sorts within a group by handicap index ascending, nulls last', () => {
		const players = [
			player('NoHandicap', 'A', null),
			player('High', 'A', 20),
			player('Low', 'A', 2)
		];
		const groups = groupPlayersByFlight(players, ['A']);

		expect(groups[0].players.map((p) => p.name)).toEqual(['Low', 'High', 'NoHandicap']);
	});

	it('drops a configured flight group entirely when it has no players', () => {
		const players = [player('Amy', 'A', 10)];
		const groups = groupPlayersByFlight(players, ['A', 'B']);

		expect(groups.map((g) => g.group.flight)).toEqual(['A']);
	});

	it('collapses to a single "All players" group when no flights are configured, regardless of the players\' own flight values', () => {
		// This is the exact shape of the real 2026 Member-Guest demo
		// tournament: tournaments.flights was never populated (still `[]`),
		// but every player still carries a real, non-empty flight string
		// (grandfathered/seeded data from before flighting was configured
		// for that tournament). Grouping is driven entirely by
		// tournaments.flights, per spec 4.2 — with nothing configured there,
		// there's no defined display order to group by, so every player
		// collapses into one catch-all group rather than being silently
		// dropped (the actual bug this suite exists to pin down) or grouped
		// by an ad hoc, alphabetically-discovered order (the "not
		// alphabetical" ordering the backlog task explicitly ruled out).
		const players = [
			player('Ethan', 'Championship', 12),
			player('Layla', 'A Flight', 8),
			player('Riley', 'B Flight', 15)
		];
		const groups = groupPlayersByFlight(players, []);

		expect(groups).toHaveLength(1);
		expect(groups[0].group).toEqual({ flight: '', label: 'All players' });
		expect(groups[0].players.map((p) => p.name)).toEqual(['Layla', 'Ethan', 'Riley']);
	});

	it('never silently drops a player whose flight is not in the configured list', () => {
		// The actual regression this suite guards against: an earlier
		// version of groupPlayersByFlight matched the catch-all group by
		// `flight === ''` alone, so any player whose flight was a real but
		// unconfigured value (not '', not one of `flights`) matched no
		// group at all and vanished from the display entirely.
		const players = [player('Configured', 'A', 5), player('Stray', 'Q', 3), player('Blank', '', 9)];
		const groups = groupPlayersByFlight(players, ['A']);

		const allNames = groups.flatMap((g) => g.players.map((p) => p.name));
		expect(allNames).toContain('Stray');
		expect(allNames).toContain('Blank');
		expect(allNames).toHaveLength(3);
	});

	it('groups unconfigured-flight players and blank-flight players together under "Unassigned", after the configured flights', () => {
		const players = [player('InA', 'A', 1), player('Stray', 'Q', 3), player('Blank', '', 2)];
		const groups = groupPlayersByFlight(players, ['A']);

		expect(groups.map((g) => g.group.label)).toEqual(['A', 'Unassigned']);
		expect(groups[1].players.map((p) => p.name)).toEqual(['Blank', 'Stray']);
	});

	it('returns no groups at all for an empty player list', () => {
		expect(groupPlayersByFlight([], [])).toEqual([]);
		expect(groupPlayersByFlight([], ['A', 'B'])).toEqual([]);
	});
});
