import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Shared guard for every Admin/Owner-only page (see the "more admin-only
// pages" note in the Role management UI backlog item) — individual pages
// under this route don't need to re-check the caller's role themselves.
// public.users has no client-readable RLS policy yet (spec 6.5), so the
// role check goes through the whoami Edge Function (service-role) rather
// than a direct table read.
export const load: LayoutServerLoad = async ({ locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	const { data, error } = await supabase.functions.invoke<{ role: string }>('whoami');
	if (error || !data || (data.role !== 'admin' && data.role !== 'owner')) {
		redirect(303, '/');
	}

	return { role: data.role as 'admin' | 'owner' };
};
