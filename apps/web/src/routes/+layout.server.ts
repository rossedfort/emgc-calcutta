import { redirect } from '@sveltejs/kit';
import { isProfileComplete, type UserProfile } from '$lib/profile';
import type { LayoutServerLoad } from './$types';

// Fallback <title>/meta description for any route that doesn't set its own
// (see app.d.ts's PageData) — every real page overrides these, but this
// still backstops the root +error.svelte boundary, which has no load of its
// own and only ever sees whatever ancestor layouts already returned.
const DEFAULT_TITLE = 'EMGC Bet';
const DEFAULT_DESCRIPTION =
	"The EMGC golf league's Calcutta auction — browse players, bid, and follow results.";

// Routes exempt from the onboarding-gate redirect below: `/` is where the
// OnboardingModal itself renders, `/profile` and `/settings/notifications`
// stay directly reachable both as an alternate way to finish onboarding
// (typing the URL, a bookmark) and afterward for edits, and `/login` has no
// session yet for any of this to apply to.
const ONBOARDING_EXEMPT_PATHS = ['/', '/profile', '/settings/notifications', '/login'];

export const load: LayoutServerLoad = async ({ locals: { session, supabase }, cookies, url }) => {
	// Best-effort: only used for the AppShell's nav links and profile
	// dropdown. The /admin route group re-checks role itself, so a failure or
	// stale value here just affects what's displayed, not authorization.
	let profile: UserProfile | null = null;
	let notificationsSetupPending = false;
	if (session) {
		const { data } = await supabase
			.from('users')
			.select('first_name, last_name, email, avatar_url, role')
			.eq('id', session.user.id)
			.single();
		profile = (data as UserProfile) ?? null;

		// Notification-prefs completeness (spec 4.7's opt-in step): no
		// notification_prefs row exists at all yet (that route's own load/
		// action creates it lazily, on first save). Computed unconditionally
		// (not just when off the settings path) so OnboardingModal always
		// knows whether this step is still needed, regardless of which page
		// happens to be loading.
		const { data: prefsRow } = await supabase
			.from('notification_prefs')
			.select('id')
			.eq('user_id', session.user.id)
			.maybeSingle();
		notificationsSetupPending = !prefsRow;

		// Onboarding gate: an incomplete profile (spec 4.1 — OAuth/
		// passwordless sign-in only ever hands back a single name blob,
		// best-effort split into first_name/last_name by handle_new_user(),
		// not guaranteed for a single-word name, no name at all, or a
		// multi-word surname that split oddly) or a still-pending
		// notification choice sends every other route back to `/`, where
		// OnboardingModal (see +page.svelte) is the single, non-dismissible
		// place either gets finished — replaces what used to be two
		// separate redirects to two separate pages.
		const profileIncomplete = profile ? !isProfileComplete(profile) : false;
		if (
			(profileIncomplete || notificationsSetupPending) &&
			!ONBOARDING_EXEMPT_PATHS.includes(url.pathname)
		) {
			redirect(303, '/');
		}
	}

	return {
		session,
		cookies: cookies.getAll(),
		profile,
		notificationsSetupPending,
		title: DEFAULT_TITLE,
		description: DEFAULT_DESCRIPTION
	};
};
