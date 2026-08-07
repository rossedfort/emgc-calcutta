import { error } from '@sveltejs/kit';
import type { AuditEventRow } from '$lib/auditActions';
import { formatPlayerName } from '$lib/players';
import type { PageServerLoad } from './$types';
import { parseAuditFilters, queryAuditEvents, type AuditFilters } from './shared';

// Server-side, URL-param-driven filtering (a plain GET form, not client-side
// array filtering like the players list) — audit_events only ever grows, so
// loading everything into the browser and filtering there doesn't scale the
// way it's fine to for a single tournament's player roster.
export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	const filters = parseAuditFilters(url);

	const [{ data, error: queryError }, { data: tournaments, error: tournamentsError }] =
		await Promise.all([
			queryAuditEvents(supabase, filters, { limit: 100 }),
			supabase.from('tournaments').select('id, name').order('created_at', { ascending: false })
		]);
	if (queryError) {
		error(500, queryError.message);
	}
	if (tournamentsError) {
		error(500, tournamentsError.message);
	}

	const events: AuditEventRow[] = (data ?? []).map((row) => ({
		id: row.id,
		action: row.action,
		entity_type: row.entity_type,
		entity_id: row.entity_id,
		actor_identity: row.actor_identity,
		created_at: row.created_at,
		tournament_name: (row.tournaments as { name: string } | null)?.name ?? null,
		player_name: row.players
			? formatPlayerName(row.players as { first_name: string; last_name: string })
			: null
	}));

	return {
		events,
		tournaments: tournaments ?? [],
		filters: filters satisfies AuditFilters,
		title: 'Audit log · EMGC Bet',
		description: 'Search and export the EMGC Bet admin audit trail.'
	};
};
