import { error, fail } from '@sveltejs/kit';
import type { Enums, Tables } from '@emgc-calcutta/shared-types';
import type { Actions, PageServerLoad } from './$types';

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

// One row per player_entries row (Phase 11) — a Championship golfer
// appears twice, once per division, since bidding/auction UI is inherently
// per-sellable-unit. `id` is the entry's own id (player_entries.id) — what
// place-bid targets and what the Svelte `#each` keys on, since a golfer's
// two entries must never collide. Self-linking targets the golfer's own
// identity row instead, sourced separately via UnlinkedPlayer above.
export type FieldPlayerRow = {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	handicap_index: number | null;
	status: Enums<'player_status'>;
	user_id: string | null;
	// Phase 20 ("the field"): is_field flags the synthetic "The Field"
	// identity itself; field_entry_id (set only on a swept, status = 'field'
	// entry) points at that group's field entry. Both come along in this
	// same tournament-wide list rather than a separate query — every board
	// below derives "who's pooled into this field lot" by filtering this
	// one list for field_entry_id === the field entry's own id, no extra
	// round trip needed.
	is_field: boolean;
	field_entry_id: string | null;
};

export const load: PageServerLoad = async ({ locals: { supabase }, parent }) => {
	const { tournament } = await parent();

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, field_entry_id, players(id, slug, first_name, last_name, flight, handicap_index, user_id, is_field)'
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
							slug: entry.players.slug,
							first_name: entry.players.first_name,
							last_name: entry.players.last_name,
							flight: entry.players.flight,
							division: entry.division,
							handicap_index: entry.players.handicap_index,
							status: entry.status,
							user_id: entry.players.user_id,
							is_field: entry.players.is_field,
							field_entry_id: entry.field_entry_id
						}
					]
				: []
		)
		.sort(
			(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
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

	return {
		players,
		unlinkedPlayers: unlinkedPlayers ?? []
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
