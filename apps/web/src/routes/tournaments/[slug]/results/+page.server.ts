import { error, redirect } from '@sveltejs/kit';
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
	winning_bid: { amount: number; bidder_name: string | null } | null;
	payout: { pot_share: number; amount: number } | null;
}

export type ResultsGroup = SharedResultsGroup<ResultsRow>;

// Phase 15: read-only, all-authenticated mirror of
// /admin/tournaments/[slug]/results — same row-building/grouping shape (via
// $lib/results, shared with that page), but no placement-editing modal and
// no Admin gate. Differs from the admin page in one deliberate way: reads
// bids.bidder_name (denormalized, already readable by any participant via
// bids_select_participant_plus) instead of embedding winning_bid.bidder:
// users(...), which only resolves under Admin/Owner RLS today — a plain
// participant reading someone else's users row comes back null. Only the
// name is needed here (no email/phone, unlike the stake buy-back flows), so
// bidder_name sidesteps that gap entirely rather than widening users RLS.
//
// Payouts additionally need a new RLS policy (this phase's own migration,
// payouts_select_completed_tournament) — payouts_select_self_or_admin_owner
// alone would leave every other participant's payout rows invisible here.
//
// Only meaningful once a tournament is actually done — a direct hit on this
// route for a tournament that isn't status = 'complete' yet (whether or not
// it's ever linked to from the homepage, which only links past tournaments)
// redirects to the tournament's own hub page instead of rendering a
// half-finished view with no placements/payouts.
export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select('id, name, flights, championship_flight, payout_structure, status')
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}
	if (tournament.status !== 'complete') {
		redirect(303, `/tournaments/${params.slug}`);
	}

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select(
			'id, flight, division, status, placement, players(first_name, last_name), winning_bid:bids!player_entries_winning_bid_id_fkey(amount, bidder_name)'
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
		tournamentName: tournament.name,
		title: `${tournament.name} · Results · EMGC Bet`,
		description: `See how the ${tournament.name} auction paid out.`
	};
};
