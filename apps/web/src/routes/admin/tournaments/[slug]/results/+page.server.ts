import { error } from '@sveltejs/kit';
import {
	groupResultsByFlightDivision,
	sortResultsByPlacement,
	sumPayoutsByEntryId
} from '$lib/results';
import type { ResultsGroup as SharedResultsGroup } from '$lib/results';
import type { PageServerLoad } from './$types';

export interface ResultsRow {
	id: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	status: 'sold_silent' | 'sold_live';
	placement: number | null;
	winning_bid: {
		amount: number;
		bidder: {
			id: string;
			first_name: string | null;
			last_name: string | null;
			email: string;
		} | null;
	} | null;
	payout: { pot_share: number; amount: number } | null;
}

export type ResultsGroup = SharedResultsGroup<ResultsRow>;

// Route deliberately deviates from spec 6.9's flat /admin/results, same
// precedent set on the bookkeeping task: results are entered per
// tournament, so a tournament-scoped tab fits this app's actual workflow
// better than a flat cross-tournament page.
//
// Only sold entries are eligible for a placement (set-placement itself
// rejects anything else) — open/reserved/no_bid entries never appear
// here. winning_bid:bids!player_entries_winning_bid_id_fkey and
// bidder:users(...) mirror the bookkeeping page's own disambiguated
// embeds (player_entries<->bids has two FK paths; see that page's load
// function for the full explanation).
//
// Sorted by placement ascending (1st, 2nd, 3rd... in finishing order),
// nulls last so not-yet-placed entries trail the list rather than
// scattering among the placed ones; name is a secondary sort so the
// not-yet-placed group has a stable order across reloads instead of
// shuffling arbitrarily — done client-side (Phase 11) since the query
// root is now player_entries, so first_name/last_name live on the
// embedded `players` resource rather than the queried table itself.
// Every successful set-placement call triggers invalidateAll() on the
// client, so a row visibly moves to its new position in the list the
// moment a placement is saved.
//
// Phase 7.5: grouped by (flight, division) — one placement list per
// group (in tournaments.flights order, Championship expanding into
// Gross/Net) instead of one flat tournament-wide list, matching
// EnterResultsModal's own grouping (deriveFlightDivisionGroups).
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select(
			'id, flight, division, status, placement, players(first_name, last_name), winning_bid:bids!player_entries_winning_bid_id_fkey(amount, bidder:users(id, first_name, last_name, email))'
		)
		.eq('tournament_id', tournament.id)
		.in('status', ['sold_silent', 'sold_live']);
	if (entriesError) {
		error(500, entriesError.message);
	}

	const { data: payouts, error: payoutsError } = await supabase
		.from('payouts')
		.select('entry_id, pot_share, amount')
		.eq('tournament_id', tournament.id);
	if (payoutsError) {
		error(500, payoutsError.message);
	}
	const payoutByEntryId = sumPayoutsByEntryId(payouts ?? []);

	const rows: ResultsRow[] = sortResultsByPlacement(
		(entries ?? []).flatMap((entry) =>
			entry.players
				? [
						{
							id: entry.id,
							first_name: entry.players.first_name,
							last_name: entry.players.last_name,
							flight: entry.flight,
							division: entry.division,
							// The .in('status', [...]) filter above already guarantees this
							// at runtime — narrowed explicitly since Postgres/PostgREST's
							// generated type is the full player_status enum, not the two
							// values this query actually returns.
							status: entry.status as 'sold_silent' | 'sold_live',
							placement: entry.placement,
							winning_bid: entry.winning_bid,
							payout: payoutByEntryId.get(entry.id) ?? null
						}
					]
				: []
		)
	);

	const flights = tournament.flights as string[];
	const championshipFlight = tournament.championship_flight as string | null;
	const results: ResultsGroup[] = groupResultsByFlightDivision(rows, flights, championshipFlight);

	return {
		payoutStructure: tournament.payout_structure as Record<string, number>,
		results,
		title: `${tournament.name} · Results · EMGC Bet`,
		description: `Enter and review placements for ${tournament.name}.`
	};
};
