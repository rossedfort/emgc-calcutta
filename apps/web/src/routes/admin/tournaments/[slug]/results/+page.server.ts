import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface ResultsRow {
	id: string;
	name: string;
	status: 'sold_silent' | 'sold_live';
	placement: number | null;
	winning_bid: {
		amount: number;
		bidder: { id: string; name: string | null; email: string } | null;
	} | null;
	payout: { pot_share: number; amount: number } | null;
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
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: players, error: playersError } = await supabase
		.from('players')
		.select(
			'id, name, status, placement, winning_bid:bids!players_winning_bid_id_fkey(amount, bidder:users(id, name, email))'
		)
		.eq('tournament_id', tournament.id)
		.in('status', ['sold_silent', 'sold_live'])
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

	return {
		payoutStructure: tournament.payout_structure as Record<string, number>,
		players: rows
	};
};
