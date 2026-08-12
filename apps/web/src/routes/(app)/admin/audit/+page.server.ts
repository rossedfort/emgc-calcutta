import { error } from '@sveltejs/kit';
import type { AuditEventRow } from '$lib/auditActions';
import { formatPlayerName } from '$lib/players';
import { parsePageSize } from '$lib/pagination';
import {
	buildCursorPage,
	decodeCursor,
	encodeCursor,
	parseCursorDirection
} from '$lib/server/cursorPagination';
import type { PageServerLoad } from './$types';
import { parseAuditFilters, queryAuditEvents, type AuditFilters } from './shared';

// Server-side, URL-param-driven filtering (a plain GET form, not client-side
// array filtering like the players list) — audit_events only ever grows, so
// loading everything into the browser and filtering there doesn't scale the
// way it's fine to for a single tournament's player roster.
//
// Cursor-based pagination (Phase 35) rather than offset: audit_events is
// append-only and this page's own "Live" tail toggle proves it takes writes
// mid-session, so a plain ?page=2 could skip or duplicate rows as someone
// pages backward through history. See $lib/server/cursorPagination.ts for
// the shared encode/decode/hasNext/hasPrev logic.
export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	const filters = parseAuditFilters(url);
	const pageSize = parsePageSize(url.searchParams.get('page_size'));
	const direction = parseCursorDirection(url.searchParams.get('dir'));
	const cursor = decodeCursor(url.searchParams.get('cursor'));

	const [{ data, error: queryError }, { data: tournaments, error: tournamentsError }] =
		await Promise.all([
			queryAuditEvents(supabase, filters, { limit: pageSize + 1, cursor, direction }),
			supabase.from('tournaments').select('id, name').order('created_at', { ascending: false })
		]);
	if (queryError) {
		error(500, queryError.message);
	}
	if (tournamentsError) {
		error(500, tournamentsError.message);
	}

	const { rows, hasNext, hasPrev } = buildCursorPage(
		data ?? [],
		direction,
		cursor !== null,
		pageSize
	);

	const events: AuditEventRow[] = rows.map((row) => ({
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
		pageSize,
		hasNext,
		hasPrev,
		nextCursor:
			hasNext && rows.length > 0
				? encodeCursor({
						sortValue: rows[rows.length - 1].created_at,
						id: rows[rows.length - 1].id
					})
				: null,
		prevCursor:
			hasPrev && rows.length > 0
				? encodeCursor({ sortValue: rows[0].created_at, id: rows[0].id })
				: null,
		title: 'Audit log · EMGC Bet',
		description: 'Search and export the EMGC Bet admin audit trail.'
	};
};
