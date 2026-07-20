import { error, redirect } from '@sveltejs/kit';
import type { Player } from '$lib/players';
import type { PageServerLoad } from './$types';

export type PlayerRow = Pick<
	Player,
	'id' | 'slug' | 'first_name' | 'last_name' | 'flight' | 'division' | 'handicap_index' | 'status'
>;

export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	// RLS scopes both queries: a tournament a Participant can't see (a dry
	// run) resolves to no rows here, same as a typo'd slug — a 404, not a
	// 403, so this doesn't leak which slugs exist.
	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select('id, slug, name, flights')
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
		.select('id, slug, first_name, last_name, flight, division, handicap_index, status')
		.eq('tournament_id', tournament.id)
		.order('first_name')
		.order('last_name');
	if (playersError) {
		error(500, playersError.message);
	}

	return {
		tournament,
		players: (players as PlayerRow[] | null) ?? [],
		title: `${tournament.name} · Players · EMGC Calcutta`,
		description: `Browse every player in the ${tournament.name} field.`
	};
};
