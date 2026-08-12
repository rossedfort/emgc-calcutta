import { error } from '@sveltejs/kit';
import type { WhoamiResponse } from '@emgc-calcutta/shared-types';
import type { RequestHandler } from './$types';

// Wraps a value in double quotes (doubling any internal quotes) only when
// it actually needs it — commas, quotes, or newlines. Same hand-rolled
// helper as admin/audit/export (not worth sharing across two call sites,
// see that route's own comment on why this isn't a new dependency).
function csvField(value: string): string {
	if (/[",\r\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

// "ID" round-trips through import-csv-preview's HEADER_ALIASES so a
// re-upload of this exact export is recognized as an update, not a fresh
// add — see that function's own header-alias table. One row per Player
// identity, not per player_entries row — a Championship-flight golfer's
// Gross/Net split is re-derived from `flight` on re-import, not something
// this export needs to represent directly.
const HEADER_ROW = [
	'ID',
	'First Name',
	'Last Name',
	'Flight',
	'Handicap',
	'Preferences',
	'Photo URL'
];

export const GET: RequestHandler = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		error(401, 'Not authenticated');
	}

	const { data: whoami, error: whoamiError } =
		await supabase.functions.invoke<WhoamiResponse>('whoami');
	if (whoamiError || !whoami || (whoami.role !== 'admin' && whoami.role !== 'owner')) {
		error(403, 'Forbidden');
	}

	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select('id, slug, name')
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}

	const { data: players, error: playersError } = await supabase
		.from('players')
		.select('id, first_name, last_name, flight, handicap_index, preferences, photo_url')
		.eq('tournament_id', tournament.id)
		.order('flight')
		.order('last_name')
		.order('first_name');
	if (playersError) {
		error(500, playersError.message);
	}

	const rows = (players ?? []).map((player) =>
		[
			player.id,
			player.first_name,
			player.last_name,
			player.flight,
			player.handicap_index ?? '',
			player.preferences ?? '',
			player.photo_url ?? ''
		].map((value) => csvField(String(value)))
	);

	const csv = [HEADER_ROW.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
	const filename = `${tournament.slug}-roster-${new Date().toISOString().slice(0, 10)}.csv`;

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
};
