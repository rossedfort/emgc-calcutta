import { describe, expect, it } from 'vitest';
import { parseTournamentForm } from './shared';

// A minimal set of every other required field, valid on its own, so each
// test below only has to vary buy_back_percentage/event_start_at and never
// gets a false-positive error from an unrelated field.
function baseFormData(overrides: Record<string, string> = {}): FormData {
	const fields: Record<string, string> = {
		name: 'Test Tournament',
		kind: 'production',
		silent_auction_start: '2026-07-01T09:00',
		silent_auction_end: '2026-07-01T17:00',
		tz_offset_minutes: '0',
		threshold_amount: '500',
		min_increment: '5',
		minimum_bid: '1',
		anti_snipe_seconds: '15',
		payout_structure: '{}',
		flights: '[]',
		championship_flight: '',
		...overrides
	};
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		formData.set(key, value);
	}
	return formData;
}

describe('parseTournamentForm — buy_back_percentage', () => {
	it('defaults to null when left blank (feature off for the tournament)', () => {
		const { data, errors } = parseTournamentForm(baseFormData());
		expect(errors.buy_back_percentage).toBeUndefined();
		expect(data?.buy_back_percentage).toBeNull();
	});

	it('converts a whole-number percentage to a 0-1 fraction', () => {
		const { data, errors } = parseTournamentForm(baseFormData({ buy_back_percentage: '50' }));
		expect(errors.buy_back_percentage).toBeUndefined();
		expect(data?.buy_back_percentage).toBe(0.5);
	});

	it('rejects 0 and 100 — must leave both sides something to own', () => {
		expect(
			parseTournamentForm(baseFormData({ buy_back_percentage: '0' })).errors.buy_back_percentage
		).toBeDefined();
		expect(
			parseTournamentForm(baseFormData({ buy_back_percentage: '100' })).errors.buy_back_percentage
		).toBeDefined();
	});

	it('rejects a negative or non-numeric value', () => {
		expect(
			parseTournamentForm(baseFormData({ buy_back_percentage: '-5' })).errors.buy_back_percentage
		).toBeDefined();
		expect(
			parseTournamentForm(baseFormData({ buy_back_percentage: 'abc' })).errors.buy_back_percentage
		).toBeDefined();
	});

	it('accepts the boundary values 1 and 99', () => {
		expect(
			parseTournamentForm(baseFormData({ buy_back_percentage: '1' })).data?.buy_back_percentage
		).toBe(0.01);
		expect(
			parseTournamentForm(baseFormData({ buy_back_percentage: '99' })).data?.buy_back_percentage
		).toBe(0.99);
	});
});

describe('parseTournamentForm — event_start_at', () => {
	it('defaults to null when left blank (no buy-back cutoff)', () => {
		const { data, errors } = parseTournamentForm(baseFormData());
		expect(errors.event_start_at).toBeUndefined();
		expect(data?.event_start_at).toBeNull();
	});

	it('converts using the same tz_offset_minutes as the auction window fields', () => {
		const { data, errors } = parseTournamentForm(
			baseFormData({ event_start_at: '2026-07-10T08:00', tz_offset_minutes: '360' })
		);
		expect(errors.event_start_at).toBeUndefined();
		expect(data?.event_start_at).toBe('2026-07-10T14:00:00.000Z');
	});

	it('is independent of buy_back_percentage in both directions', () => {
		// A cutoff date with no percentage set is accepted (harmless, just
		// unused until the percentage is also configured) — this form
		// deliberately doesn't force the two fields to be set together,
		// matching request-stake-buyback's own "null event_start_at means
		// no gate" behavior on the other side of this feature.
		const cutoffOnly = parseTournamentForm(baseFormData({ event_start_at: '2026-07-10T08:00' }));
		expect(cutoffOnly.errors.event_start_at).toBeUndefined();
		expect(cutoffOnly.data?.buy_back_percentage).toBeNull();

		const percentageOnly = parseTournamentForm(baseFormData({ buy_back_percentage: '50' }));
		expect(percentageOnly.errors.buy_back_percentage).toBeUndefined();
		expect(percentageOnly.data?.event_start_at).toBeNull();
	});
});
