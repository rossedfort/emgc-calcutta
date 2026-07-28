import type { Role } from '$lib/roles';

export interface UserProfile {
	first_name: string | null;
	last_name: string | null;
	email: string;
	avatar_url: string | null;
	role: Role;
	name_confirmed_at: string | null;
}

// null whenever either half is missing, rather than a partial "First" or
// "Last" string — callers fall back to email in that case (see AppShell,
// /profile), same as before this field was split.
export function formatUserName(
	profile: Pick<UserProfile, 'first_name' | 'last_name'>
): string | null {
	if (!profile.first_name || !profile.last_name) return null;
	return `${profile.first_name} ${profile.last_name}`;
}

// The profile-completion gate (root +layout.server.ts): first_name/
// last_name auto-split by handle_new_user() counts as complete on its own
// for the common case (a normal two-word OAuth name) — this only actually
// redirects anyone to /profile for the real edge cases (single-word name,
// no name at all, a multi-word surname that split oddly leaving one half
// empty). email is included for symmetry/future-proofing per spec 4.1, but
// is effectively a no-op today: it's already `not null` and populated by
// handle_new_user() for every sign-in path.
export function isProfileComplete(
	profile: Pick<UserProfile, 'first_name' | 'last_name' | 'email'>
): boolean {
	return Boolean(profile.first_name && profile.last_name && profile.email);
}

// The onboarding gate's actual "still need to show the name step" check
// (root +layout.server.ts, OnboardingModal) — deliberately *not* the same
// as `!isProfileComplete()`. OAuth sign-in usually populates both names via
// handle_new_user()'s best-effort split of the provider's name blob, so an
// isProfileComplete-only check would skip the step entirely for most users,
// even though they never actually reviewed or corrected that guess.
// name_confirmed_at is only ever set by a successful updateProfile submit
// (which itself requires both names to be non-empty), so it's a strict
// superset of isProfileComplete — no separate completeness check is needed
// alongside it.
export function needsNameConfirmation(profile: Pick<UserProfile, 'name_confirmed_at'>): boolean {
	return !profile.name_confirmed_at;
}
