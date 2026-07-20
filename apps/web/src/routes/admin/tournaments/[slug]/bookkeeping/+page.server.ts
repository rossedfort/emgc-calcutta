import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface BookkeepingRow {
	id: string;
	slug: string;
	name: string;
	division: string;
	status: 'sold_silent' | 'sold_live';
	buyer_marked_paid_at: string | null;
	winning_bid: {
		amount: number;
		bidder: { id: string; name: string | null; email: string } | null;
	} | null;
}

export interface PayoutRow {
	id: string;
	placement: number;
	pot_share: number;
	amount: number;
	marked_paid_at: string | null;
	player: { name: string; division: string } | null;
	bidder: { id: string; name: string | null; email: string } | null;
}

// Only sold players have a winning bid to mark paid — open/reserved/no_bid
// players never appear here, unlike the general players roster page.
// winning_bid:bids!players_winning_bid_id_fkey disambiguates the embed the
// same way void-bid's server-side query does: players<->bids now has two
// FK paths (bids.player_id and players.winning_bid_id), so PostgREST can't
// infer which one this embed means without the hint.
//
// payouts rows won't exist yet until the set-placement task (Phase 7,
// later) is built — this section renders empty until then, same as any
// other tournament before results are entered.
//
// bidder:users!payouts_bidder_id_fkey needs the same disambiguation
// hint, for a different reason than the players<->bids embed above:
// payouts has two FK paths to users (bidder_id and marked_paid_by), not
// a bidirectional pair between the same two tables like players<->bids —
// but the effect on PostgREST's embed inference is the same "more than
// one relationship was found" failure.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: players, error: playersError } = await supabase
		.from('players')
		.select(
			'id, slug, name, division, status, buyer_marked_paid_at, winning_bid:bids!players_winning_bid_id_fkey(amount, bidder:users(id, name, email))'
		)
		.eq('tournament_id', tournament.id)
		.in('status', ['sold_silent', 'sold_live'])
		.order('name');
	if (playersError) {
		error(500, playersError.message);
	}

	const { data: payouts, error: payoutsError } = await supabase
		.from('payouts')
		.select(
			'id, placement, pot_share, amount, marked_paid_at, player:players(name, division), bidder:users!payouts_bidder_id_fkey(id, name, email)'
		)
		.eq('tournament_id', tournament.id)
		.order('placement');
	if (payoutsError) {
		error(500, payoutsError.message);
	}

	return {
		players: (players as BookkeepingRow[] | null) ?? [],
		payouts: (payouts as PayoutRow[] | null) ?? [],
		title: `${tournament.name} · Bookkeeping · EMGC Calcutta`,
		description: `Track paid and unpaid winning bids and payouts for ${tournament.name}.`
	};
};
