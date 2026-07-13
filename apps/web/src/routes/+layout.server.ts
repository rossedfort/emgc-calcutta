import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { session, supabase }, cookies }) => {
	// Best-effort: only used to decide which nav links the AppShell shows. The
	// /admin route group re-checks this itself, so a failure here just hides
	// links rather than being a real authorization concern.
	let isAdmin = false;
	if (session) {
		const { data } = await supabase.functions.invoke<{ role: string }>('whoami');
		isAdmin = data?.role === 'admin' || data?.role === 'owner';
	}

	return { session, cookies: cookies.getAll(), isAdmin };
};
