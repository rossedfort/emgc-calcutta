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
		.order('created_at', { ascending: false })
		.limit(1);

	return { tournament: (data?.[0] as Tournament | undefined) ?? null };
};
