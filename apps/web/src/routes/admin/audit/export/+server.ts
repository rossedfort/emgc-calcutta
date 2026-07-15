import { error } from '@sveltejs/kit';
import type { WhoamiResponse } from '@emgc-calcutta/shared-types';
import type { RequestHandler } from './$types';
import { parseAuditFilters, queryAuditEvents } from '../shared';

// Wraps a value in double quotes (doubling any internal quotes) only when
// it actually needs it — commas, quotes, or newlines. Hand-rolled rather
// than pulling in a CSV library (papaparse, used elsewhere in this repo,
// is only a dependency of the Deno Edge Functions, not apps/web) — proper
// escaping for a handful of known columns doesn't need one.
function csvField(value: string): string {
	if (/[",\r\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

const HEADER_ROW = [
	'Time',
	'Action',
	'Entity type',
	'Entity ID',
	'Actor',
	'Player',
	'Tournament',
	'Reason',
	'Before',
	'After'
];

// Same filtered query as the list page, deliberately uncapped — spec 4.6
// calls this "exportable to CSV for offline dispute resolution", which
// means the whole filtered set, not just the 200 most recent rows the
// on-screen table caps itself to.
//
// +server.ts route handlers don't inherit /admin/+layout.server.ts's role
// guard — that's a `load` function, which only runs for page renders, not
// for a bare GET request to an endpoint under the same URL tree. RLS on
// audit_events already means a non-admin caller gets zero rows back
// either way, but this endpoint should say so explicitly (401/403) rather
// than silently handing back a CSV with just a header row.
export const GET: RequestHandler = async ({ url, locals: { session, supabase } }) => {
	if (!session) {
		error(401, 'Not authenticated');
	}

	const { data: whoami, error: whoamiError } =
		await supabase.functions.invoke<WhoamiResponse>('whoami');
	if (whoamiError || !whoami || (whoami.role !== 'admin' && whoami.role !== 'owner')) {
		error(403, 'Forbidden');
	}

	const filters = parseAuditFilters(url);

	const { data, error: queryError } = await queryAuditEvents(supabase, filters);
	if (queryError) {
		error(500, queryError.message);
	}

	const rows = (data ?? []).map((row) => {
		const tournamentName = (row.tournaments as { name: string } | null)?.name ?? '';
		const playerName = (row.players as { name: string } | null)?.name ?? '';
		return [
			row.created_at,
			row.action,
			row.entity_type,
			row.entity_id ?? '',
			row.actor_identity ?? '',
			playerName,
			tournamentName,
			row.reason ?? '',
			row.before !== null ? JSON.stringify(row.before) : '',
			row.after !== null ? JSON.stringify(row.after) : ''
		].map((value) => csvField(String(value)));
	});

	const csv = [HEADER_ROW.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
	const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
};
