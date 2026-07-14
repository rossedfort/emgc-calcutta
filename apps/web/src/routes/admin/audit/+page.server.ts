import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface AuditEventRow {
	id: string;
	action: string;
	entity_type: string;
	entity_id: string | null;
	actor_identity: string | null;
	created_at: string;
	tournament_name: string | null;
	player_name: string | null;
}

export interface AuditFilters {
	participant: string;
	player: string;
	action: string;
	start: string;
	end: string;
}

// Server-side, URL-param-driven filtering (a plain GET form, not client-side
// array filtering like the players list) — audit_events only ever grows, so
// loading everything into the browser and filtering there doesn't scale the
// way it's fine to for a single tournament's player roster.
export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	const participant = url.searchParams.get('participant')?.trim() ?? '';
	const player = url.searchParams.get('player')?.trim() ?? '';
	const action = url.searchParams.get('action')?.trim() ?? '';
	const start = url.searchParams.get('start') ?? '';
	const end = url.searchParams.get('end') ?? '';

	let query = supabase
		.from('audit_events')
		.select(
			'id, action, entity_type, entity_id, actor_identity, created_at, tournaments(name), players(name)'
		)
		.order('created_at', { ascending: false })
		.limit(200);

	if (participant) {
		query = query.ilike('actor_identity', `%${participant}%`);
	}
	if (action) {
		// Exact match now that this is a dropdown of known values, not free
		// text — see $lib/auditActions.ts.
		query = query.eq('action', action);
	}
	if (start) {
		query = query.gte('created_at', new Date(start).toISOString());
	}
	if (end) {
		query = query.lte('created_at', new Date(end).toISOString());
	}

	// entity_id is polymorphic and player_id has no denormalized name of its
	// own, so "filter by player name" is a two-step lookup: find matching
	// player ids first, then filter audit_events by those — same approach
	// the backlog's "Audit log query" task confirmed player_id itself for.
	if (player) {
		const { data: matchingPlayers, error: playersError } = await supabase
			.from('players')
			.select('id')
			.ilike('name', `%${player}%`);
		if (playersError) {
			error(500, playersError.message);
		}
		const ids = (matchingPlayers ?? []).map((p) => p.id);
		// No matches: filter down to an id that can never exist, rather than
		// skipping the filter entirely (which would silently show everyone).
		query = query.in('player_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
	}

	const { data, error: queryError } = await query;
	if (queryError) {
		error(500, queryError.message);
	}

	const events: AuditEventRow[] = (data ?? []).map((row) => ({
		id: row.id,
		action: row.action,
		entity_type: row.entity_type,
		entity_id: row.entity_id,
		actor_identity: row.actor_identity,
		created_at: row.created_at,
		tournament_name: (row.tournaments as { name: string } | null)?.name ?? null,
		player_name: (row.players as { name: string } | null)?.name ?? null
	}));

	return {
		events,
		filters: { participant, player, action, start, end } satisfies AuditFilters
	};
};
