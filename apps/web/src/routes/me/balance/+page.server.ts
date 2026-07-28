import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface OwedRow {
	id: string;
	first_name: string;
	last_name: string;
	division: string;
	status: 'sold_silent' | 'sold_live';
	buyer_marked_paid_at: string | null;
	tournament: { name: string } | null;
	winning_bid: { amount: number } | null;
}

export interface WonRow {
	id: string;
	placement: number;
	amount: number;
	marked_paid_at: string | null;
	tournament: { name: string } | null;
	player: { first_name: string; last_name: string; division: string } | null;
}

// Spec 4.8/6.9: "Self" access — any authenticated user, not just
// Participants, since self-bidding (spec 4.9) means an Admin or Owner
// can just as easily owe money into the pot or have won a payout.
//
// "What you owe": every entry this user's winning bid bought, across
// every tournament — winning_bid:bids!player_entries_winning_bid_id_fkey!inner
// makes the embed an inner join so .eq('winning_bid.bidder_id', ...) can
// filter on it; RLS alone isn't enough to scope this to "mine" for an
// Admin/Owner caller, since bids_select_participant_plus deliberately
// lets Admin/Owner read every bid (needed for the live auction UI), not
// just their own.
//
// "What you've won": every Payout where this user is the winning
// bidder. Scoping this to "mine" for an Admin/Owner caller does NOT
// happen automatically from RLS alone here either — same reasoning as
// above, payouts_select_self_or_admin_owner's "or admin/owner" branch
// grants read access to *every* payout, not just this user's, so the
// explicit bidder_id filter is still required for correctness, not just
// defense-in-depth.
export const load: PageServerLoad = async ({ locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}
	const userId = session.user.id;

	const { data: owedEntries, error: owedError } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, buyer_marked_paid_at, tournament:tournaments(name), players(first_name, last_name), winning_bid:bids!player_entries_winning_bid_id_fkey!inner(amount, bidder_id)'
		)
		.eq('winning_bid.bidder_id', userId);
	if (owedError) {
		error(500, owedError.message);
	}

	// Sorted client-side, not via .order() — the query root is now
	// player_entries (Phase 11), so first_name/last_name live on the
	// embedded `players` resource rather than the queried table itself.
	const owed: OwedRow[] = (owedEntries ?? [])
		.flatMap((entry) =>
			entry.players
				? [
						{
							id: entry.id,
							first_name: entry.players.first_name,
							last_name: entry.players.last_name,
							division: entry.division,
							status: entry.status as 'sold_silent' | 'sold_live',
							buyer_marked_paid_at: entry.buyer_marked_paid_at,
							tournament: entry.tournament,
							winning_bid: entry.winning_bid
						}
					]
				: []
		)
		.sort(
			(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
		);

	// entry:player_entries(division, players(first_name, last_name)) —
	// payouts.entry_id has a single FK path to player_entries (no
	// disambiguation hint needed there), but division lives on
	// player_entries while first_name/last_name live on players, so this
	// embed nests one level deeper than the pre-split query did.
	const { data: wonRows, error: wonError } = await supabase
		.from('payouts')
		.select(
			'id, placement, amount, marked_paid_at, tournament:tournaments(name), entry:player_entries(division, players(first_name, last_name))'
		)
		.eq('bidder_id', userId)
		.order('placement');
	if (wonError) {
		error(500, wonError.message);
	}

	const won: WonRow[] = (wonRows ?? []).map((payout) => ({
		id: payout.id,
		placement: payout.placement,
		amount: payout.amount,
		marked_paid_at: payout.marked_paid_at,
		tournament: payout.tournament,
		player: payout.entry?.players
			? {
					first_name: payout.entry.players.first_name,
					last_name: payout.entry.players.last_name,
					division: payout.entry.division
				}
			: null
	}));

	return {
		owed,
		won,
		title: 'My balance · EMGC Bet',
		description: "What you owe and what you've won across every EMGC Bet tournament."
	};
};
