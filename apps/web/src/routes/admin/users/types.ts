import type { Role } from '$lib/roles';

export interface UserRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	role: Role;
	created_at: string;
}
