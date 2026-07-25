import { describe, expect, it } from 'vitest';
import { tournamentPhase } from './tournamentPhase';

function tournament(overrides: {
	status?: string;
	silent_auction_start: string;
	silent_auction_end: string;
	live_auction_started_at?: string | null;
}) {
	return {
		status: overrides.status ?? 'active',
		silent_auction_start: overrides.silent_auction_start,
		silent_auction_end: overrides.silent_auction_end,
		live_auction_started_at: overrides.live_auction_started_at ?? null
	};
}

describe('tournamentPhase', () => {
	const start = '2026-01-10T00:00:00Z';
	const end = '2026-01-20T00:00:00Z';

	it('is "upcoming" with a countdown to the silent start before it opens', () => {
		const now = new Date('2026-01-05T00:00:00Z');
		const result = tournamentPhase(
			tournament({ silent_auction_start: start, silent_auction_end: end }),
			now
		);
		expect(result.phase).toBe('upcoming');
		expect(result.countdownTo).toEqual(new Date(start));
	});

	it('is "silent" with a countdown to the silent close while the window is open', () => {
		const now = new Date('2026-01-15T00:00:00Z');
		const result = tournamentPhase(
			tournament({ silent_auction_start: start, silent_auction_end: end }),
			now
		);
		expect(result.phase).toBe('silent');
		expect(result.countdownTo).toEqual(new Date(end));
	});

	it('is "between" with no countdown once silent closes but live hasn\'t started', () => {
		const now = new Date('2026-01-25T00:00:00Z');
		const result = tournamentPhase(
			tournament({ silent_auction_start: start, silent_auction_end: end }),
			now
		);
		expect(result.phase).toBe('between');
		expect(result.countdownTo).toBeNull();
	});

	it('is "live" once live_auction_started_at is set, even if silent_auction_end is somehow in the future', () => {
		const now = new Date('2026-01-15T00:00:00Z');
		const result = tournamentPhase(
			tournament({
				silent_auction_start: start,
				silent_auction_end: end,
				live_auction_started_at: '2026-01-14T00:00:00Z'
			}),
			now
		);
		expect(result.phase).toBe('live');
		expect(result.countdownTo).toBeNull();
	});

	it('is "complete" regardless of timestamps once the tournament status says so', () => {
		const now = new Date('2026-01-15T00:00:00Z');
		const result = tournamentPhase(
			tournament({ status: 'complete', silent_auction_start: start, silent_auction_end: end }),
			now
		);
		expect(result.phase).toBe('complete');
		expect(result.countdownTo).toBeNull();
	});
});
