import { error, redirect } from '@sveltejs/kit';
import type { Enums } from '@emgc-calcutta/shared-types';
import type { PageServerLoad } from './$types';

// One row per player_entries row in this tournament — the full field, not
// pre-filtered to "entries this user bid on," since the current-high
// computation needs every bidder's bids (via the Realtime store, same
// pattern as TournamentRoster/the dashboard's own boards), not just this
// user's own. The page itself narrows down to "mine" client-side once the
// live bid feed is in.
export type FieldEntryRow = {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	division: string;
	status: Enums<'player_status'>;
};

// Spec 6.9's route table calls for "My bids" ("participant's own bid
// history across all players") but it was never built — this is the
// Phase 19 version, tournament-scoped from the start (see this phase's
// backlog entry) rather than needing a later rework like /me/balance did.
export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
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

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select('id, division, status, players(slug, first_name, last_name)')
		.eq('tournament_id', tournament.id);
	if (entriesError) {
		error(500, entriesError.message);
	}

	const players: FieldEntryRow[] = (entries ?? []).flatMap((entry) =>
		entry.players
			? [
					{
						id: entry.id,
						slug: entry.players.slug,
						first_name: entry.players.first_name,
						last_name: entry.players.last_name,
						division: entry.division,
						status: entry.status
					}
				]
			: []
	);

	return {
		tournament,
		players,
		currentUserId: session.user.id,
		title: `My bids · ${tournament.name} · EMGC Bet`,
		description: `Your bid activity in the ${tournament.name} auction.`
	};
};
