import type { UserProfile } from '$lib/profile';
import type { LayoutServerLoad } from './$types';

// Fallback <title>/meta description for any route that doesn't set its own
// (see app.d.ts's PageData) — every real page overrides these, but this
// still backstops the root +error.svelte boundary, which has no load of its
// own and only ever sees whatever ancestor layouts already returned.
const DEFAULT_TITLE = 'EMGC Calcutta';
const DEFAULT_DESCRIPTION =
	"The EMGC golf league's Calcutta auction — browse players, bid, and follow results.";

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

	return {
		session,
		cookies: cookies.getAll(),
		profile,
		title: DEFAULT_TITLE,
		description: DEFAULT_DESCRIPTION
	};
};
