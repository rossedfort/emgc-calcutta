import { error } from '@sveltejs/kit';
import type { Enums } from '@emgc-calcutta/shared-types';
import type { PageServerLoad } from './$types';

export interface PlaceBidsEntry {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	status: Enums<'player_status'>;
}

export interface PlaceBidsParticipant {
	id: string;
	name: string;
	email: string;
}

// Every entry (not just currently-open ones) — the silent-phase type-ahead
// filters to status = 'open' client-side (and stays live-updated via the
// same Realtime entries stream the merged live auction screen already
// uses), while live phase resolves the currently-open lot's entry against
// this same list rather than a second query.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: entryRows, error: entriesError } = await supabase
		.from('player_entries')
		.select('id, division, status, players(slug, first_name, last_name, flight)')
		.eq('tournament_id', tournament.id);
	if (entriesError) {
		error(500, entriesError.message);
	}

	const entries: PlaceBidsEntry[] = (entryRows ?? [])
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
							status: entry.status
						}
					]
				: []
		)
		.sort(
			(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
		);

	// Every participant with a roster entry in this tournament — place-bid's
	// own roster-membership check means a bidderId without one would just
	// fail server-side, so the search is pre-scoped to people who can
	// actually be bid for. One players row per golfer, but the same user
	// can in principle be linked to more than one (self-bidding is
	// unrestricted, spec 4.9), so this dedupes by user id rather than
	// listing them twice.
	const { data: rosterRows, error: rosterError } = await supabase
		.from('players')
		.select('user_id, users(id, first_name, last_name, email)')
		.eq('tournament_id', tournament.id)
		.not('user_id', 'is', null);
	if (rosterError) {
		error(500, rosterError.message);
	}

	const participantsById = new Map<string, PlaceBidsParticipant>();
	for (const row of rosterRows ?? []) {
		if (!row.users) continue;
		participantsById.set(row.users.id, {
			id: row.users.id,
			name:
				[row.users.first_name, row.users.last_name].filter(Boolean).join(' ') || row.users.email,
			email: row.users.email
		});
	}

	return {
		tournament,
		entries,
		participants: [...participantsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
		title: `${tournament.name} · Place bids · EMGC Bet`,
		description: `Place bids on behalf of participants for ${tournament.name}.`
	};
};
