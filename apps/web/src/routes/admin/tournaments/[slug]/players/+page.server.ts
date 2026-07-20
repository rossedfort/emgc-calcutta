import { error } from '@sveltejs/kit';
import type { Player } from '$lib/players';
import type { PageServerLoad } from './$types';

export type PlayerRow = Pick<
	Player,
	'id' | 'slug' | 'name' | 'flight' | 'division' | 'handicap_index' | 'status' | 'user_id'
>;

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: players, error: playersError } = await supabase
		.from('players')
		.select('id, slug, name, flight, division, handicap_index, status, user_id')
		.eq('tournament_id', tournament.id)
		.order('name');
	if (playersError) {
		error(500, playersError.message);
	}

	return {
		players: (players as PlayerRow[] | null) ?? [],
		title: `${tournament.name} · Players · EMGC Calcutta`,
		description: `Manage the ${tournament.name} player roster.`
	};
};
