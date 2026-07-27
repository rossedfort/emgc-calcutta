import { redirect } from '@sveltejs/kit';
import { isProfileComplete, type UserProfile } from '$lib/profile';
import type { LayoutServerLoad } from './$types';

// Fallback <title>/meta description for any route that doesn't set its own
// (see app.d.ts's PageData) — every real page overrides these, but this
// still backstops the root +error.svelte boundary, which has no load of its
// own and only ever sees whatever ancestor layouts already returned.
const DEFAULT_TITLE = 'EMGC Calcutta';
const DEFAULT_DESCRIPTION =
	"The EMGC golf league's Calcutta auction — browse players, bid, and follow results.";

const NOTIFICATION_SETTINGS_PATH = '/settings/notifications';

export const load: LayoutServerLoad = async ({ locals: { session, supabase }, cookies, url }) => {
	// Best-effort: only used for the AppShell's nav links and profile
	// dropdown. The /admin route group re-checks role itself, so a failure or
	// stale value here just affects what's displayed, not authorization.
	let profile: UserProfile | null = null;
	if (session) {
		const { data } = await supabase
			.from('users')
			.select('first_name, last_name, email, avatar_url, role')
			.eq('id', session.user.id)
			.single();
		profile = (data as UserProfile) ?? null;

		// Profile-completion gate (spec 4.1): OAuth/passwordless sign-in only
		// ever hands back a single name blob, best-effort split into
		// first_name/last_name by handle_new_user() — fine for the common
		// two-word-name case, but not guaranteed (single-word names, no name
		// at all, a multi-word surname splitting oddly). Checked on every
		// request, same as /admin's own per-request role gate, so no route
		// can be missed. /profile is exempt (there has to be somewhere to
		// actually fix it); /login is exempt since there's no session yet
		// for this to apply to.
		if (
			profile &&
			!isProfileComplete(profile) &&
			url.pathname !== '/profile' &&
			url.pathname !== '/login'
		) {
			redirect(303, '/profile');
		}

		// Notification-preferences onboarding gate: once the profile-
		// completion gate above clears, every user gets sent to
		// /settings/notifications exactly once — until they've made an
		// explicit choice there (even leaving everything off), no
		// notification_prefs row exists at all (that route's own load/
		// action creates it lazily, on first save). Exempts the settings
		// page itself (nowhere else to actually make that choice) and
		// /login, same reasoning as the profile gate above.
		if (
			profile &&
			isProfileComplete(profile) &&
			url.pathname !== NOTIFICATION_SETTINGS_PATH &&
			url.pathname !== '/login'
		) {
			const { data: prefsRow } = await supabase
				.from('notification_prefs')
				.select('id')
				.eq('user_id', session.user.id)
				.maybeSingle();
			if (!prefsRow) {
				redirect(303, NOTIFICATION_SETTINGS_PATH);
			}
		}
	}

	return {
		session,
		cookies: cookies.getAll(),
		profile,
		title: DEFAULT_TITLE,
		description: DEFAULT_DESCRIPTION
	};
};
