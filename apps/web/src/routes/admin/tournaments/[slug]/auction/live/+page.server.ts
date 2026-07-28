import { fail } from '@sveltejs/kit';
import type { Enums } from '@emgc-calcutta/shared-types';
import type { Actions, PageServerLoad } from './$types';

// One row per player_entries row (Phase 11) — see FieldPlayerRow
// (tournaments/[slug]/+page.server.ts) for the same shape and reasoning.
export type LiveAdminPlayer = {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	handicap_index: number | null;
	status: Enums<'player_status'>;
	user_id: string | null;
};

// No own tournament lookup — inherits it from the [slug] layout's load via
// parent(), same as the queue page. Current lot / next-queued lot aren't
// pre-fetched here: they're derived client-side from the Realtime store
// (same liveLots stream the participant screen uses), since this is a
// live-operational page that needs to react to opens/closes/bids as they
// happen, not just on page load.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: entries } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, players(slug, first_name, last_name, flight, handicap_index, user_id)'
		)
		.eq('tournament_id', tournament.id);

	const players: LiveAdminPlayer[] = (entries ?? [])
		.flatMap((entry) =>
			entry.players
				? [
						{
							id: entry.id,
							slug: entry.players.slug,
							first_name: entry.players.first_name,
							last_name: entry.players.last_name,
							flight: entry.players.flight,
							division: entry.division,
							handicap_index: entry.players.handicap_index,
							status: entry.status,
							user_id: entry.players.user_id
						}
					]
				: []
		)
		.sort(
			(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
		);

	return {
		tournament,
		players,
		title: `${tournament.name} · Live auction · EMGC Bet`,
		description: `Run the live auction for ${tournament.name}.`
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
