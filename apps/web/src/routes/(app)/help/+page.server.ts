import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {
		title: 'Help · EMGC Bet',
		description: 'How to browse the field, bid, and (for Admins) run the EMGC Bet auction.'
	};
};
