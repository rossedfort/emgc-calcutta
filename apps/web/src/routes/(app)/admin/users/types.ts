import type { Role } from '$lib/roles';

export interface UserRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	role: Role;
	rejected_at: string | null;
	created_at: string;
}

// Mirrors supabase/functions/_shared/contracts/list-users.ts's
// ListUsersResponse — hand-duplicated rather than imported, matching this
// function's existing precedent (its request/response shape was already
// only typed inline at the +page.server.ts call site, not shared via
// @emgc-calcutta/shared-types like some other functions' contracts are).
export interface ListUsersResponse {
	pending: UserRow[];
	rejected: UserRow[];
	others: UserRow[];
	othersTotal: number;
}
