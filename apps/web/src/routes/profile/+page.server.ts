import { error, redirect } from '@sveltejs/kit';
import type { UserProfile } from '$lib/profile';
import type { PageServerLoad } from './$types';

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

	return { profile: data as UserProfile };
};
