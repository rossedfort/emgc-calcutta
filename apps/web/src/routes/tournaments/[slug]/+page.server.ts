import { error, fail, redirect } from '@sveltejs/kit';
import type { Enums } from '@emgc-calcutta/shared-types';
import type { Actions, PageServerLoad } from './$types';

// One row per player_entries row (Phase 11) — a Championship golfer
// appears twice, once per division, since bidding/auction UI is inherently
// per-sellable-unit. `id` is the entry's own id (player_entries.id) — what
// place-bid targets and what the Svelte `#each` keys on, since a golfer's
// two entries must never collide. `playerId` (players.id, the golfer's own
// identity row) is carried separately for SelfLinkModal, which links a
// whole golfer, not one specific entry.
export type FieldPlayerRow = {
	id: string;
	playerId: string;
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	handicap_index: number | null;
	status: Enums<'player_status'>;
	user_id: string | null;
};

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
			'id, slug, name, flights, championship_flight, status, silent_auction_start, silent_auction_end, live_auction_started_at, threshold_amount, min_increment'
		)
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, players(id, slug, first_name, last_name, flight, handicap_index, user_id)'
		)
		.eq('tournament_id', tournament.id);
	if (entriesError) {
		error(500, entriesError.message);
	}

	// Sorted client-side, not via .order() — the query root is now
	// player_entries (Phase 11), so first_name/last_name live on the
	// embedded `players` resource rather than the queried table itself.
	const players: FieldPlayerRow[] = (entries ?? [])
		.flatMap((entry) =>
			entry.players
				? [
						{
							id: entry.id,
							playerId: entry.players.id,
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
