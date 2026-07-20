import { error, redirect } from '@sveltejs/kit';
import type { Player } from '$lib/players';
import type { PageServerLoad } from './$types';

export type LiveAuctionPlayerRow = Pick<
	Player,
	'id' | 'slug' | 'name' | 'flight' | 'division' | 'handicap_index' | 'status' | 'user_id'
>;

export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	// RLS scopes both queries the same way as the silent auction board: a
	// tournament a Participant can't see (a dry run) or a typo'd slug both
	// resolve to a 404, not a 403.
	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select('id, slug, name, min_increment')
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}

	// Bids and live_lots aren't pre-fetched here, same reasoning as the
	// silent board — the Realtime store reconciles both itself on mount, so
	// this only needs the relatively static player roster to cross-reference
	// against whichever lot the store says is currently open.
	const { data: players, error: playersError } = await supabase
		.from('players')
		.select('id, slug, name, flight, division, handicap_index, status, user_id')
		.eq('tournament_id', tournament.id)
		.order('name');
	if (playersError) {
		error(500, playersError.message);
	}

	return {
		tournament,
		players: (players as LiveAuctionPlayerRow[] | null) ?? [],
		currentUserId: session.user.id,
		title: `${tournament.name} · Live auction · EMGC Calcutta`,
		description: `Bid live on the current lot in the ${tournament.name} auction.`
	};
};
