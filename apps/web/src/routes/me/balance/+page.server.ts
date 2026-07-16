import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface OwedRow {
	id: string;
	name: string;
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
	player: { name: string } | null;
}

// Spec 4.8/6.9: "Self" access — any authenticated user, not just
// Participants, since self-bidding (spec 4.9) means an Admin or Owner
// can just as easily owe money into the pot or have won a payout.
//
// "What you owe": every player this user's winning bid bought, across
// every tournament — winning_bid:bids!players_winning_bid_id_fkey!inner
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

	const { data: owed, error: owedError } = await supabase
		.from('players')
		.select(
			'id, name, status, buyer_marked_paid_at, tournament:tournaments(name), winning_bid:bids!players_winning_bid_id_fkey!inner(amount, bidder_id)'
		)
		.eq('winning_bid.bidder_id', userId)
		.order('name');
	if (owedError) {
		error(500, owedError.message);
	}

	const { data: won, error: wonError } = await supabase
		.from('payouts')
		.select(
			'id, placement, amount, marked_paid_at, tournament:tournaments(name), player:players(name)'
		)
		.eq('bidder_id', userId)
		.order('placement');
	if (wonError) {
		error(500, wonError.message);
	}

	return {
		owed: (owed as OwedRow[] | null) ?? [],
		won: (won as WonRow[] | null) ?? []
	};
};
