import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { session } }) => {
	if (session) {
		redirect(303, '/');
	}

	return {
		title: 'Sign in · EMGC Calcutta',
		description: 'Sign in to EMGC Calcutta with Google, Microsoft, or email.'
	};
};
