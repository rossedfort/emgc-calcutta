import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Enums } from '@emgc-calcutta/shared-types';

// One row per player_entries row (Phase 11) — a Championship golfer appears
// twice, once per division, since bidding/auction UI is inherently
// per-sellable-unit. `id` is the entry's own id (player_entries.id) — what
// place-bid targets and what the Svelte `#each` keys on, since a golfer's
// two entries must never collide.
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
	// entry) points at that group's field entry.
	is_field: boolean;
	field_entry_id: string | null;
};

// Shared by the participant tournament page (tournaments/[slug]/+page.server.ts)
// and the admin-only live-auction TV display
// (admin/tournaments/[slug]/auction/live/tv/+page.server.ts) — both render the
// same LiveAuctionBoard-shaped content off the same tournament-wide entry
// list, so this query lived in only one of the two before the TV route
// existed and would otherwise have had to be copy-pasted into the second.
export async function loadFieldPlayers(
	supabase: SupabaseClient<Database>,
	tournamentId: string
): Promise<FieldPlayerRow[]> {
	const { data: entries, error } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, field_entry_id, players(id, slug, first_name, last_name, flight, handicap_index, user_id, is_field)'
		)
		.eq('tournament_id', tournamentId);
	if (error) {
		throw error;
	}

	// Sorted client-side, not via .order() — the query root is player_entries
	// (Phase 11), so first_name/last_name live on the embedded `players`
	// resource rather than the queried table itself.
	return (entries ?? [])
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
}
