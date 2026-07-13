import type { PageServerLoad } from './$types';
import type { Tournament } from './shared';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	// Spec 3: "a single internal league runs one Tournament at a time" — this
	// UI never lets a second one be created (see new/+page.server.ts), but
	// .limit(1) rather than .maybeSingle() so this page doesn't hard-error if
	// that invariant is ever violated some other way (e.g. direct DB access).
	const { data } = await supabase
		.from('tournaments')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(1);

	return { tournament: (data?.[0] as Tournament | undefined) ?? null };
};
