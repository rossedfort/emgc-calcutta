import { error } from '@sveltejs/kit';
import type { Enums } from '@emgc-calcutta/shared-types';
import type { PageServerLoad } from './$types';

// One row per player_entries row (Phase 11) — see FieldPlayerRow
// (tournaments/[slug]/+page.server.ts) for the same shape and reasoning.
export type PlayerRow = {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	handicap_index: number | null;
	status: Enums<'player_status'>;
	user_id: string | null;
};

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, players(slug, first_name, last_name, flight, handicap_index, user_id)'
		)
		.eq('tournament_id', tournament.id);
	if (entriesError) {
		error(500, entriesError.message);
	}

	const players: PlayerRow[] = (entries ?? [])
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
							user_id: entry.players.user_id
						}
					]
				: []
		)
		.sort(
			(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
		);

	return {
		players,
		title: `${tournament.name} · Players · EMGC Bet`,
		description: `Manage the ${tournament.name} player roster.`
	};
};
