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
	status: 'sold_silent' | 'sold_live' | 'field';
	placement: number | null;
	winning_bid: { amount: number; bidder_name: string | null } | null;
	payout: { pot_share: number; amount: number } | null;
	// Phase 20 ("the field"): set only for a swept row (status = 'field') —
	// who bought the field lot this player was pooled into, and a link to
	// it. winning_bid stays null for these rows — the pool sold together,
	// not this player individually, so showing its own sale price as if it
	// were this one player's winning bid would misattribute it.
	viaField: { slug: string; name: string; bidderName: string | null } | null;
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
		.select(
			'id, slug, name, flights, championship_flight, payout_structure, status, bid_anonymity_enabled'
		)
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

	// Phase 23: presentational suppression only — bidder_name is dropped
	// here, before it ever reaches the client, rather than fetched and hidden
	// in the template. Live auction/bid history already never send this
	// field at all for the same reason; this just makes that same behavior
	// conditional per tournament instead of universal.
	const hideBidderNames = tournament.bid_anonymity_enabled;

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select(
			'id, flight, division, status, placement, field_entry_id, players(first_name, last_name), winning_bid:bids!player_entries_winning_bid_id_fkey(amount, bidder_name)'
		)
		.eq('tournament_id', tournament.id)
		.in('status', ['sold_silent', 'sold_live', 'field']);
	if (entriesError) {
		error(500, entriesError.message);
	}

	// Phase 20 ("the field"): resolve each distinct field lot referenced by
	// a swept row above — see the admin results page's own load function
	// for why this is a second query rather than a self-referencing embed.
	const fieldEntryIds = [
		...new Set(
			(entries ?? [])
				.filter((e) => e.status === 'field' && e.field_entry_id)
				.map((e) => e.field_entry_id as string)
		)
	];
	const { data: fieldLots, error: fieldLotsError } =
		fieldEntryIds.length > 0
			? await supabase
					.from('player_entries')
					.select(
						'id, players(slug, first_name, last_name), winning_bid:bids!player_entries_winning_bid_id_fkey(bidder_name)'
					)
					.in('id', fieldEntryIds)
			: { data: [], error: null };
	if (fieldLotsError) {
		error(500, fieldLotsError.message);
	}
	const fieldLotByEntryId = new Map(
		(fieldLots ?? []).flatMap((lot) =>
			lot.players
				? [
						[
							lot.id,
							{
								slug: lot.players.slug,
								name: `${lot.players.first_name} ${lot.players.last_name}`,
								bidderName: hideBidderNames ? null : (lot.winning_bid?.bidder_name ?? null)
							}
						] as const
					]
				: []
		)
	);

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
							// generated type is the full player_status enum, not the
							// three values this query actually returns.
							status: entry.status as 'sold_silent' | 'sold_live' | 'field',
							placement: entry.placement,
							winning_bid:
								entry.status === 'field' || !entry.winning_bid
									? null
									: {
											amount: entry.winning_bid.amount,
											bidder_name: hideBidderNames ? null : entry.winning_bid.bidder_name
										},
							payout: payoutByEntryId.get(entry.id) ?? null,
							viaField:
								entry.status === 'field' && entry.field_entry_id
									? (fieldLotByEntryId.get(entry.field_entry_id) ?? null)
									: null
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
		tournamentSlug: tournament.slug,
		title: `${tournament.name} · Results · EMGC Bet`,
		description: `See how the ${tournament.name} auction paid out.`
	};
};
