import { error, redirect } from '@sveltejs/kit';
import type { Player } from '$lib/players';
import type { PageServerLoad } from './$types';

export type AuctionPlayerRow = Pick<
	Player,
	'id' | 'slug' | 'name' | 'flight' | 'handicap_index' | 'status' | 'user_id'
>;

export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	// RLS scopes both queries the same way as the players list/detail routes:
	// a tournament a Participant can't see (a dry run) or a typo'd slug both
	// resolve to a 404, not a 403.
	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select(
			'id, slug, name, silent_auction_start, silent_auction_end, threshold_amount, min_increment'
		)
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}

	const { data: players, error: playersError } = await supabase
		.from('players')
		.select('id, slug, name, flight, handicap_index, status, user_id')
		.eq('tournament_id', tournament.id)
		.order('name');
	if (playersError) {
		error(500, playersError.message);
	}

	return {
		tournament,
		players: (players as AuctionPlayerRow[] | null) ?? [],
		currentUserId: session.user.id
	};
};
