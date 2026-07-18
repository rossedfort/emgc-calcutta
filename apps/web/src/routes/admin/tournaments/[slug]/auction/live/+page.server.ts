import { fail } from '@sveltejs/kit';
import type { Tables } from '@emgc-calcutta/shared-types';
import type { Actions, PageServerLoad } from './$types';

export type LiveAdminPlayer = Pick<
	Tables<'players'>,
	'id' | 'slug' | 'name' | 'flight' | 'division' | 'handicap_index' | 'status' | 'user_id'
>;

// No own tournament lookup — inherits it from the [slug] layout's load via
// parent(), same as the queue page. Current lot / next-queued lot aren't
// pre-fetched here: they're derived client-side from the Realtime store
// (same liveLots stream the participant screen uses), since this is a
// live-operational page that needs to react to opens/closes/bids as they
// happen, not just on page load.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: players } = await supabase
		.from('players')
		.select('id, slug, name, flight, division, handicap_index, status, user_id')
		.eq('tournament_id', tournament.id)
		.order('name');

	return {
		tournament,
		players: (players as LiveAdminPlayer[] | null) ?? []
	};
};

export const actions: Actions = {
	advance: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const lotId = String(formData.get('lotId') ?? '');
		if (!lotId) {
			return fail(400, { error: 'Missing lot' });
		}

		const { error: openError } = await supabase.rpc('open_live_lot', { lot_id: lotId });
		if (openError) {
			return fail(400, { error: openError.message });
		}
	},

	close: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const lotId = String(formData.get('lotId') ?? '');
		if (!lotId) {
			return fail(400, { error: 'Missing lot' });
		}

		const { error: closeError } = await supabase.rpc('close_live_lot', { lot_id: lotId });
		if (closeError) {
			return fail(400, { error: closeError.message });
		}
	}
};
