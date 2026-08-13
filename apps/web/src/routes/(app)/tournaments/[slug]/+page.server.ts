import { error, fail } from '@sveltejs/kit';
import type { Tables } from '@emgc-calcutta/shared-types';
import { loadFieldPlayers } from '$lib/server/fieldPlayers';
import type { Actions, PageServerLoad } from './$types';

export type { FieldPlayerRow } from '$lib/server/fieldPlayers';

// One row per unlinked golfer (Phase 11) — queried directly off `players`
// rather than derived from the entry-scoped FieldPlayerRow list below, so a
// Championship golfer naturally appears once, not twice: no dedup step
// needed at all now that identity and entries are separate tables (unlike
// the sibling-dedup-by-name filter this replaces, back when a Championship
// golfer was two independent `players` rows).
export type UnlinkedPlayer = Pick<
	Tables<'players'>,
	'id' | 'first_name' | 'last_name' | 'handicap_index'
>;

export const load: PageServerLoad = async ({ locals: { supabase }, parent }) => {
	const { tournament, currentUserId } = await parent();

	const players = await loadFieldPlayers(supabase, tournament.id).catch((e: { message: string }) =>
		error(500, e.message)
	);

	const { data: unlinkedPlayers, error: unlinkedPlayersError } = await supabase
		.from('players')
		.select('id, first_name, last_name, handicap_index')
		.eq('tournament_id', tournament.id)
		.is('user_id', null)
		.order('first_name')
		.order('last_name');
	if (unlinkedPlayersError) {
		error(500, unlinkedPlayersError.message);
	}

	// Phase 39: entry ids (player_entries.id, matching FieldPlayerRow.id
	// above) this Participant has favorited in this tournament — RLS
	// (player_favorites_select_self) already scopes this to their own rows,
	// the explicit .eq is just for clarity/defense in depth, matching how
	// other tournament-scoped queries in this app filter explicitly rather
	// than relying on RLS alone.
	const { data: favoriteRows, error: favoritesError } = await supabase
		.from('player_favorites')
		.select('entry_id')
		.eq('user_id', currentUserId);
	if (favoritesError) {
		error(500, favoritesError.message);
	}

	return {
		players,
		unlinkedPlayers: unlinkedPlayers ?? [],
		favoriteEntryIds: (favoriteRows ?? []).map((row) => row.entry_id)
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
