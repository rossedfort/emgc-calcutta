import { redirect } from '@sveltejs/kit';
import type { Tournament } from './admin/tournaments/shared';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	const { data } = await supabase
		.from('tournaments')
		.select('*')
		.order('created_at', { ascending: false });

	const tournaments = (data as Tournament[] | null) ?? [];

	return {
		tournaments: tournaments.filter((t) => t.status !== 'complete'),
		pastTournaments: tournaments.filter((t) => t.status === 'complete')
	};
};
