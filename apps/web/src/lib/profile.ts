import type { Role } from '$lib/roles';

export interface UserProfile {
	name: string | null;
	email: string;
	avatar_url: string | null;
	role: Role;
}
