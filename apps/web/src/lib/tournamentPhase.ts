import type { Tables } from '@emgc-calcutta/shared-types';

export type TournamentPhase = 'upcoming' | 'silent' | 'between' | 'live' | 'complete';

export interface PhaseInfo {
	phase: TournamentPhase;
	label: string;
	/** Only set when the next phase change happens at a known, fixed time —
	 *  the live auction's start (and end) are Admin-triggered, not
	 *  scheduled, so 'between' and 'live' never carry a countdown target. */
	countdownTo: Date | null;
	countdownLabel: string | null;
}

type PhaseTournament = Pick<
	Tables<'tournaments'>,
	'status' | 'silent_auction_start' | 'silent_auction_end' | 'live_auction_started_at'
>;

// Which of "silent auction, live auction, or neither" a tournament is in
// right now, plus a countdown to the next phase where one has a fixed
// target. live_auction_started_at, once set, is checked before the silent
// window at all — the live auction is a one-way gate that never re-opens
// silent bidding, regardless of the current time relative to
// silent_auction_end.
export function tournamentPhase(tournament: PhaseTournament, now: Date): PhaseInfo {
	if (tournament.status === 'complete') {
		return { phase: 'complete', label: 'Complete', countdownTo: null, countdownLabel: null };
	}

	if (tournament.live_auction_started_at) {
		return { phase: 'live', label: 'Live auction', countdownTo: null, countdownLabel: null };
	}

	const start = new Date(tournament.silent_auction_start);
	const end = new Date(tournament.silent_auction_end);

	if (now < start) {
		return {
			phase: 'upcoming',
			label: 'Not started yet',
			countdownTo: start,
			countdownLabel: 'Silent auction opens in'
		};
	}

	if (now <= end) {
		return {
			phase: 'silent',
			label: 'Silent auction',
			countdownTo: end,
			countdownLabel: 'Closes in'
		};
	}

	return {
		phase: 'between',
		label: 'Silent auction closed — waiting for the live auction to start',
		countdownTo: null,
		countdownLabel: null
	};
}
