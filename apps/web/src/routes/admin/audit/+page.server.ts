import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { parseAuditFilters, queryAuditEvents, type AuditFilters } from './shared';

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

// Server-side, URL-param-driven filtering (a plain GET form, not client-side
// array filtering like the players list) — audit_events only ever grows, so
// loading everything into the browser and filtering there doesn't scale the
// way it's fine to for a single tournament's player roster.
export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	const filters = parseAuditFilters(url);

	const { data, error: queryError } = await queryAuditEvents(supabase, filters, { limit: 200 });
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
		filters: filters satisfies AuditFilters
	};
};
