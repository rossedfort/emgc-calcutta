import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@emgc-calcutta/shared-types';
import {
	cursorFilterExpression,
	type Cursor,
	type CursorDirection
} from '$lib/server/cursorPagination';
import { localDateTimeToUtcIso } from '$lib/time';

export interface AuditFilters {
	participant: string;
	player: string;
	// Phase 37: upgraded from a single exact-match value to a list — the
	// header-embedded checkbox-list control (TableHeaderSelectFilter) is
	// inherently multi-select, and there's no reason to artificially
	// restrict these two to one value each when the query change is a
	// one-line .eq -> .in (an admin could always only pick one, matching
	// today's behavior exactly, but now isn't limited to it).
	tournaments: string[];
	actions: string[];
	start: string;
	end: string;
	// The browser's own Date.prototype.getTimezoneOffset(), submitted
	// alongside the raw start/end datetime-local values (which have no
	// timezone of their own) so queryAuditEvents can convert them to the
	// correct UTC instant — see $lib/time.ts's localDateTimeToUtcIso.
	tzOffsetMinutes: number;
}

export function parseAuditFilters(url: URL): AuditFilters {
	const tzOffsetRaw = Number(url.searchParams.get('tz_offset_minutes'));
	return {
		participant: url.searchParams.get('participant')?.trim() ?? '',
		player: url.searchParams.get('player')?.trim() ?? '',
		tournaments: url.searchParams.getAll('tournament'),
		actions: url.searchParams.getAll('action'),
		start: url.searchParams.get('start') ?? '',
		end: url.searchParams.get('end') ?? '',
		tzOffsetMinutes: Number.isFinite(tzOffsetRaw) ? tzOffsetRaw : 0
	};
}

export const AUDIT_EVENT_SELECT =
	'id, action, entity_type, entity_id, actor_identity, reason, before, after, created_at, tournaments(name), players(first_name, last_name)';

// Shared by the list page and the CSV export endpoint — both need the exact
// same filtered query, just with different pagination: the list page cursor-
// paginates (options.cursor/direction, Phase 35), export intentionally
// leaves both unset for one uncapped query (offline dispute resolution means
// the whole filtered set, not just what's currently on screen).
//
// entity_id is polymorphic and player_id has no denormalized name of its
// own, so "filter by player name" is a two-step lookup: find matching
// player ids first, then filter audit_events by those — same reasoning the
// "Audit log query" task confirmed player_id itself for.
export async function queryAuditEvents(
	supabase: SupabaseClient<Database>,
	filters: AuditFilters,
	options: { limit?: number; cursor?: Cursor | null; direction?: CursorDirection } = {}
) {
	const direction = options.direction ?? 'before';
	const ascending = direction === 'after';

	let query = supabase
		.from('audit_events')
		.select(AUDIT_EVENT_SELECT)
		.order('created_at', { ascending })
		.order('id', { ascending });

	if (options.limit) {
		query = query.limit(options.limit);
	}
	if (options.cursor) {
		query = query.or(cursorFilterExpression(options.cursor, direction, 'created_at'));
	}
	if (filters.participant) {
		query = query.ilike('actor_identity', `%${filters.participant}%`);
	}
	if (filters.actions.length > 0) {
		// Exact match(es) — actions are a checkbox list of known values, not
		// free text.
		query = query.in('action', filters.actions);
	}
	const startIso = filters.start
		? localDateTimeToUtcIso(filters.start, filters.tzOffsetMinutes)
		: null;
	const endIso = filters.end ? localDateTimeToUtcIso(filters.end, filters.tzOffsetMinutes) : null;
	if (startIso) {
		query = query.gte('created_at', startIso);
	}
	if (endIso) {
		query = query.lte('created_at', endIso);
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

	if (filters.tournaments.length > 0) {
		// A checkbox list of known tournaments, not free text — exact id
		// match(es), same reasoning as Action above, no name lookup needed.
		query = query.in('tournament_id', filters.tournaments);
	}

	return query;
}
