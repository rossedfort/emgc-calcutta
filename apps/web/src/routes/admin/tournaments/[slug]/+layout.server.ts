import { error } from '@sveltejs/kit';
import type { Tournament } from '../shared';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals: { supabase } }) => {
	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select('*')
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}

	return { tournament: tournament as Tournament };
};
