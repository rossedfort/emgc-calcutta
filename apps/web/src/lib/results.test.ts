import { describe, expect, it } from 'vitest';
import {
	groupResultsByFlightDivision,
	sortResultsByPlacement,
	sumPayoutsByEntryId
} from './results';

describe('sumPayoutsByEntryId', () => {
	it('keeps a single row as-is', () => {
		const result = sumPayoutsByEntryId([{ entry_id: 'e1', pot_share: 0.5, amount: 100 }]);
		expect(result.get('e1')).toEqual({ pot_share: 0.5, amount: 100 });
	});

	it('sums a split entry (two payout rows sharing an entry_id) into one total', () => {
		const result = sumPayoutsByEntryId([
			{ entry_id: 'e1', pot_share: 0.5, amount: 45 },
			{ entry_id: 'e1', pot_share: 0.5, amount: 45 }
		]);
		expect(result.get('e1')).toEqual({ pot_share: 0.5, amount: 90 });
	});

	it('keeps entries independent by entry_id', () => {
		const result = sumPayoutsByEntryId([
			{ entry_id: 'e1', pot_share: 0.5, amount: 100 },
			{ entry_id: 'e2', pot_share: 0.3, amount: 60 }
		]);
		expect(result.get('e1')).toEqual({ pot_share: 0.5, amount: 100 });
		expect(result.get('e2')).toEqual({ pot_share: 0.3, amount: 60 });
	});
});

describe('sortResultsByPlacement', () => {
	interface Row {
		placement: number | null;
		first_name: string;
		last_name: string;
	}

	function row(placement: number | null, first_name: string, last_name: string): Row {
		return { placement, first_name, last_name };
	}

	it('sorts placed rows ascending by placement', () => {
		const rows = [row(3, 'C', 'C'), row(1, 'A', 'A'), row(2, 'B', 'B')];
		expect(sortResultsByPlacement(rows).map((r) => r.placement)).toEqual([1, 2, 3]);
	});

	it('sorts unplaced rows (null placement) after every placed row', () => {
		const rows = [row(null, 'Z', 'Z'), row(1, 'A', 'A')];
		expect(sortResultsByPlacement(rows).map((r) => r.placement)).toEqual([1, null]);
	});

	it('sorts unplaced rows among themselves by name, for a stable order', () => {
		const rows = [row(null, 'Zeb', 'Zed'), row(null, 'Amy', 'Adams')];
		expect(sortResultsByPlacement(rows).map((r) => r.first_name)).toEqual(['Amy', 'Zeb']);
	});

	it('does not mutate the input array', () => {
		const rows = [row(2, 'B', 'B'), row(1, 'A', 'A')];
		sortResultsByPlacement(rows);
		expect(rows.map((r) => r.placement)).toEqual([2, 1]);
	});
});

describe('groupResultsByFlightDivision', () => {
	interface Row {
		flight: string;
		division: string;
		name: string;
	}

	function row(flight: string, division: string, name: string): Row {
		return { flight, division, name };
	}

	it('buckets rows into their (flight, division) group', () => {
		const rows = [row('A', 'overall', 'p1'), row('B', 'overall', 'p2')];
		const groups = groupResultsByFlightDivision(rows, ['A', 'B'], null);
		expect(groups.find((g) => g.group.flight === 'A')?.players).toEqual([
			row('A', 'overall', 'p1')
		]);
		expect(groups.find((g) => g.group.flight === 'B')?.players).toEqual([
			row('B', 'overall', 'p2')
		]);
	});

	it('splits a championship flight into gross/net groups', () => {
		const rows = [row('Champ', 'gross', 'p1'), row('Champ', 'net', 'p2')];
		const groups = groupResultsByFlightDivision(rows, ['Champ'], 'Champ');
		expect(groups).toHaveLength(2);
		expect(groups.find((g) => g.group.division === 'gross')?.players).toEqual([
			row('Champ', 'gross', 'p1')
		]);
		expect(groups.find((g) => g.group.division === 'net')?.players).toEqual([
			row('Champ', 'net', 'p2')
		]);
	});

	it('returns an empty players array for a group with no matching rows', () => {
		const groups = groupResultsByFlightDivision([], ['A'], null);
		expect(groups).toEqual([
			{ group: { flight: 'A', division: 'overall', label: 'A' }, players: [] }
		]);
	});
});
