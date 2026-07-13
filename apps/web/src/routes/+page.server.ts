import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	// Best-effort: only used to decide whether to show the "Admin" link. The
	// /admin route group re-checks this itself, so a failure here just hides
	// the link rather than being a real authorization concern.
	const { data } = await supabase.functions.invoke<{ role: string }>('whoami');
	const isAdmin = data?.role === 'admin' || data?.role === 'owner';

	return { isAdmin };
};
