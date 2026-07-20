import { error, redirect } from '@sveltejs/kit';
import { formatPlayerName, type Player } from '$lib/players';
import type { PageServerLoad } from './$types';

export type PlayerProfile = Pick<
	Player,
	| 'id'
	| 'slug'
	| 'first_name'
	| 'last_name'
	| 'contact_email'
	| 'contact_phone'
	| 'preferences'
	| 'photo_url'
	| 'flight'
	| 'division'
	| 'handicap_index'
	| 'status'
	| 'user_id'
>;

export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	// RLS scopes both queries the same way as the list view: a tournament a
	// Participant can't see (a dry run) or a typo'd slug both resolve to a
	// 404, not a 403.
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

	const { data: player, error: playerError } = await supabase
		.from('players')
		.select(
			'id, slug, first_name, last_name, contact_email, contact_phone, preferences, photo_url, flight, division, handicap_index, status, user_id'
		)
		.eq('tournament_id', tournament.id)
		.eq('slug', params.playerSlug)
		.maybeSingle();
	if (playerError) {
		error(500, playerError.message);
	}
	if (!player) {
		error(404, 'Player not found');
	}

	// Only resolves to a name for the viewer themself or an Admin/Owner — RLS
	// on public.users blocks a Participant from reading another User's row,
	// so this naturally comes back null for "linked to someone else" without
	// needing to special-case that here. The profile still shows a generic
	// "linked to a participant" indicator in that case (see +page.svelte).
	let linkedUserName: string | null = null;
	if (player.user_id) {
		const { data } = await supabase
			.from('users')
			.select('name, email')
			.eq('id', player.user_id)
			.maybeSingle();
		linkedUserName = data ? (data.name ?? data.email) : null;
	}

	return {
		tournament,
		player: player as PlayerProfile,
		linkedUserName,
		isYou: player.user_id === session.user.id,
		title: `${formatPlayerName(player)} · ${tournament.name} · EMGC Calcutta`,
		description: `Player profile and bidding status for ${formatPlayerName(player)} in ${tournament.name}.`
	};
};
