import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@emgc-calcutta/shared-types';

export interface AuditFilters {
	participant: string;
	player: string;
	action: string;
	start: string;
	end: string;
}

export function parseAuditFilters(url: URL): AuditFilters {
	return {
		participant: url.searchParams.get('participant')?.trim() ?? '',
		player: url.searchParams.get('player')?.trim() ?? '',
		action: url.searchParams.get('action')?.trim() ?? '',
		start: url.searchParams.get('start') ?? '',
		end: url.searchParams.get('end') ?? ''
	};
}

export const AUDIT_EVENT_SELECT =
	'id, action, entity_type, entity_id, actor_identity, reason, before, after, created_at, tournaments(name), players(first_name, last_name)';

// Shared by the list page and the CSV export endpoint — both need the exact
// same filtered query, just with a different row cap: the list caps at 200
// for display, export intentionally doesn't (offline dispute resolution
// means the whole filtered set, not just what's currently on screen).
//
// entity_id is polymorphic and player_id has no denormalized name of its
// own, so "filter by player name" is a two-step lookup: find matching
// player ids first, then filter audit_events by those — same reasoning the
// "Audit log query" task confirmed player_id itself for.
export async function queryAuditEvents(
	supabase: SupabaseClient<Database>,
	filters: AuditFilters,
	options: { limit?: number } = {}
) {
	let query = supabase
		.from('audit_events')
		.select(AUDIT_EVENT_SELECT)
		.order('created_at', { ascending: false });

	if (options.limit) {
		query = query.limit(options.limit);
	}
	if (filters.participant) {
		query = query.ilike('actor_identity', `%${filters.participant}%`);
	}
	if (filters.action) {
		// Exact match — action is a dropdown of known values, not free text.
		query = query.eq('action', filters.action);
	}
	if (filters.start) {
		query = query.gte('created_at', new Date(filters.start).toISOString());
	}
	if (filters.end) {
		query = query.lte('created_at', new Date(filters.end).toISOString());
	}

	if (filters.player) {
		const { data: matchingPlayers, error: playersError } = await supabase
			.from('players')
			.select('id')
			.or(`first_name.ilike.%${filters.player}%,last_name.ilike.%${filters.player}%`);
		if (playersError) {
			throw playersError;
		}
		const ids = (matchingPlayers ?? []).map((p) => p.id);
		// No matches: filter down to an id that can never exist, rather than
		// skipping the filter entirely (which would silently show everyone).
		query = query.in('player_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
	}

	return query;
}
