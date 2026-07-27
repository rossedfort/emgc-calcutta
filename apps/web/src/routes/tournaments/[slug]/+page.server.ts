import { error, fail, redirect } from '@sveltejs/kit';
import type { Player } from '$lib/players';
import type { Actions, PageServerLoad } from './$types';

export type FieldPlayerRow = Pick<
	Player,
	| 'id'
	| 'slug'
	| 'first_name'
	| 'last_name'
	| 'flight'
	| 'division'
	| 'handicap_index'
	| 'status'
	| 'user_id'
>;

export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	// RLS scopes both queries: a tournament a Participant can't see (a dry
	// run) resolves to no rows here, same as a typo'd slug — a 404, not a
	// 403, so this doesn't leak which slugs exist. Selects the union of what
	// every phase's rendered UI needs (silent board's threshold/increment,
	// live board's increment, the roster view's flights) since this one page
	// now covers all of them.
	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select(
			'id, slug, name, flights, status, silent_auction_start, silent_auction_end, live_auction_started_at, threshold_amount, min_increment'
		)
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}

	const { data: players, error: playersError } = await supabase
		.from('players')
		.select('id, slug, first_name, last_name, flight, division, handicap_index, status, user_id')
		.eq('tournament_id', tournament.id)
		.order('first_name')
		.order('last_name');
	if (playersError) {
		error(500, playersError.message);
	}

	return {
		tournament,
		players: (players as FieldPlayerRow[] | null) ?? [],
		currentUserId: session.user.id,
		title: `${tournament.name} · EMGC Bet`,
		description: `Browse the field and bid in the ${tournament.name} auction.`
	};
};

export const actions: Actions = {
	// Self-service linking (spec 4.9, Phase 10) — link_self_to_player is
	// SECURITY DEFINER (see its migration) since an ordinary Participant has
	// no RLS UPDATE grant on players at all, unlike open_live_lot/
	// close_live_lot's SECURITY INVOKER, which only ever run as an
	// Admin/Owner who already has that grant directly.
	linkSelf: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const playerId = String(formData.get('playerId') ?? '');
		if (!playerId) {
			return fail(400, { error: 'Choose a player' });
		}

		const { error: linkError } = await supabase.rpc('link_self_to_player', {
			p_player_id: playerId
		});
		if (linkError) {
			return fail(400, { error: linkError.message });
		}
	}
};
