import type { Role } from '$lib/roles';

export interface UserProfile {
	first_name: string | null;
	last_name: string | null;
	email: string;
	avatar_url: string | null;
	role: Role;
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
