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

	return {
		tournament: tournament as Tournament,
		// Fallback for the Settings tab (its own +page.server.ts has no load
		// of its own) — every other tab under this layout overrides this
		// with something more specific.
		title: `${tournament.name} · Admin · EMGC Calcutta`,
		description: `Manage the ${tournament.name} tournament.`
	};
};
