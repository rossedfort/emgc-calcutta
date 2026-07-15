import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface BookkeepingRow {
	id: string;
	slug: string;
	name: string;
	status: 'sold_silent' | 'sold_live';
	buyer_marked_paid_at: string | null;
	winning_bid: {
		amount: number;
		bidder: { id: string; name: string | null; email: string } | null;
	} | null;
}

// Only sold players have a winning bid to mark paid — open/reserved/no_bid
// players never appear here, unlike the general players roster page.
// winning_bid:bids!players_winning_bid_id_fkey disambiguates the embed the
// same way void-bid's server-side query does: players<->bids now has two
// FK paths (bids.player_id and players.winning_bid_id), so PostgREST can't
// infer which one this embed means without the hint.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: players, error: playersError } = await supabase
		.from('players')
		.select(
			'id, slug, name, status, buyer_marked_paid_at, winning_bid:bids!players_winning_bid_id_fkey(amount, bidder:users(id, name, email))'
		)
		.eq('tournament_id', tournament.id)
		.in('status', ['sold_silent', 'sold_live'])
		.order('name');
	if (playersError) {
		error(500, playersError.message);
	}

	return { players: (players as BookkeepingRow[] | null) ?? [] };
};
