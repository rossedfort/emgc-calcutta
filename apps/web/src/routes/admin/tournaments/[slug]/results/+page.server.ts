import { error } from '@sveltejs/kit';
import { deriveFlightDivisionGroups, type FlightDivisionGroup } from '$lib/flightGroups';
import type { PageServerLoad } from './$types';

export interface ResultsRow {
	id: string;
	name: string;
	flight: string;
	division: string;
	status: 'sold_silent' | 'sold_live';
	placement: number | null;
	winning_bid: {
		amount: number;
		bidder: { id: string; name: string | null; email: string } | null;
	} | null;
	payout: { pot_share: number; amount: number } | null;
}

export interface ResultsGroup {
	group: FlightDivisionGroup;
	players: ResultsRow[];
}

// Route deliberately deviates from spec 6.9's flat /admin/results, same
// precedent set on the bookkeeping task: results are entered per
// tournament, so a tournament-scoped tab fits this app's actual workflow
// better than a flat cross-tournament page.
//
// Only sold players are eligible for a placement (set-placement itself
// rejects anything else) — open/reserved/no_bid players never appear
// here. winning_bid:bids!players_winning_bid_id_fkey and
// bidder:users(...) mirror the bookkeeping page's own disambiguated
// embeds (players<->bids has two FK paths; see that page's load
// function for the full explanation).
//
// Sorted by placement ascending (1st, 2nd, 3rd... in finishing order),
// nulls last so not-yet-placed players trail the list rather than
// scattering among the placed ones; name is a secondary sort so the
// not-yet-placed group has a stable order across reloads instead of
// shuffling arbitrarily. Every successful set-placement call triggers
// invalidateAll() on the client, so a row visibly moves to its new
// position in the list the moment a placement is saved.
//
// Phase 7.5: grouped by (flight, division) — one placement list per
// group (in tournaments.flights order, Championship expanding into
// Gross/Net) instead of one flat tournament-wide list, matching
// EnterResultsModal's own grouping (deriveFlightDivisionGroups). The DB
// query itself doesn't need to change beyond selecting `flight` — the
// existing placement/name ordering already gives each group's own slice
// a correctly-sorted order once bucketed, since filtering an
// already-sorted array preserves relative order.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: players, error: playersError } = await supabase
		.from('players')
		.select(
			'id, name, flight, division, status, placement, winning_bid:bids!players_winning_bid_id_fkey(amount, bidder:users(id, name, email))'
		)
		.eq('tournament_id', tournament.id)
		.in('status', ['sold_silent', 'sold_live'])
		.order('placement', { ascending: true, nullsFirst: false })
		.order('name');
	if (playersError) {
		error(500, playersError.message);
	}

	const { data: payouts, error: payoutsError } = await supabase
		.from('payouts')
		.select('player_id, pot_share, amount')
		.eq('tournament_id', tournament.id);
	if (payoutsError) {
		error(500, payoutsError.message);
	}
	const payoutByPlayerId = new Map((payouts ?? []).map((p) => [p.player_id, p]));

	const rows: ResultsRow[] = ((players as Omit<ResultsRow, 'payout'>[] | null) ?? []).map(
		(player) => ({
			...player,
			payout: payoutByPlayerId.get(player.id) ?? null
		})
	);

	const flights = tournament.flights as string[];
	const championshipFlight = tournament.championship_flight as string | null;
	const groups = deriveFlightDivisionGroups(flights, championshipFlight);
	const results: ResultsGroup[] = groups.map((group) => ({
		group,
		players: rows.filter((p) => p.flight === group.flight && p.division === group.division)
	}));

	return {
		payoutStructure: tournament.payout_structure as Record<string, number>,
		results
	};
};
