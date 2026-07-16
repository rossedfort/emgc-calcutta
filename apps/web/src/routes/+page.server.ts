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
		.neq('status', 'complete')
		.order('created_at', { ascending: false });

	return { tournaments: (data as Tournament[] | null) ?? [] };
};
