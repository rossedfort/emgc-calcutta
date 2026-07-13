import type { UserProfile } from '$lib/profile';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { session, supabase }, cookies }) => {
	// Best-effort: only used for the AppShell's nav links and profile
	// dropdown. The /admin route group re-checks role itself, so a failure or
	// stale value here just affects what's displayed, not authorization.
	let profile: UserProfile | null = null;
	if (session) {
		const { data } = await supabase
			.from('users')
			.select('name, email, avatar_url, role')
			.eq('id', session.user.id)
			.single();
		profile = (data as UserProfile) ?? null;
	}

	return { session, cookies: cookies.getAll(), profile };
};
