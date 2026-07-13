export type Role = 'unassigned' | 'participant' | 'admin' | 'owner';

export interface UserRow {
	id: string;
	name: string | null;
	email: string;
	role: Role;
	created_at: string;
}
