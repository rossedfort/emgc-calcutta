import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { session } }) => {
	if (session) {
		redirect(303, '/');
	}

	return {
		title: 'Sign in · EMGC Bet',
		description: 'Sign in to EMGC Bet with Google, Microsoft, or email.'
	};
};
