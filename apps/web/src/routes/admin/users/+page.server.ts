import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { UserRow } from './types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data, error: invokeError } = await supabase.functions.invoke<{ users: UserRow[] }>(
		'list-users'
	);
	if (invokeError || !data) {
		error(500, invokeError?.message ?? 'Failed to load users');
	}

	return {
		users: data.users,
		title: 'Users · EMGC Bet',
		description: 'Manage EMGC Bet participant and admin accounts.'
	};
};
