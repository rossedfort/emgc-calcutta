import { error, redirect } from '@sveltejs/kit';
import type { Role } from '$lib/roles';
import type { PageServerLoad } from './$types';

export interface Profile {
	name: string | null;
	email: string;
	avatar_url: string | null;
	role: Role;
}

export const load: PageServerLoad = async ({ locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	const { data, error: queryError } = await supabase
		.from('users')
		.select('name, email, avatar_url, role')
		.eq('id', session.user.id)
		.single();

	if (queryError || !data) {
		error(500, queryError?.message ?? 'Failed to load profile');
	}

	return { profile: data as Profile };
};
