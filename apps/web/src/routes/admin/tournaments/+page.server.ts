import type { PageServerLoad } from './$types';
import type { Tournament } from './shared';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	// Phase 1.6: multiple tournaments — past, active, dry runs — are fully
	// supported now (see spec sections 2 and 5), so this lists every row
	// instead of assuming at most one.
	const { data } = await supabase
		.from('tournaments')
		.select('*')
		.order('created_at', { ascending: false });

	return {
		tournaments: (data as Tournament[] | null) ?? [],
		title: 'Tournaments · EMGC Calcutta',
		description: 'Manage every EMGC Calcutta tournament.'
	};
};
