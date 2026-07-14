import type { Enums } from '../database';

// GET/POST (auth: user, no body) -> the caller's own public.users role.
// See supabase/functions/whoami/index.ts.
export interface WhoamiResponse {
	id: string;
	role: Enums<'user_role'>;
}
