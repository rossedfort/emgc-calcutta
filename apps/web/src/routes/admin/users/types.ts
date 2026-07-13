import type { Role } from '$lib/roles';

export interface UserRow {
	id: string;
	name: string | null;
	email: string;
	role: Role;
	created_at: string;
}
