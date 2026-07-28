import { error, fail, redirect } from '@sveltejs/kit';
import type { Enums, Tables } from '@emgc-calcutta/shared-types';
import { formatPlayerName } from '$lib/players';
import type { Actions, PageServerLoad } from './$types';
import { parsePlayerForm } from '../../shared';

export type Player = Pick<
	Tables<'players'>,
	| 'id'
	| 'slug'
	| 'first_name'
	| 'last_name'
	| 'preferences'
	| 'flight'
	| 'handicap_index'
	| 'user_id'
>;

// A golfer has one or two entries (Phase 11) — the single "Status" line
// this page used to show (back when a Player row was itself the sellable
// entry) becomes one line per entry instead, so a Championship golfer's
// independent Gross/Net statuses ("Gross: Open", "Net: Reserved") both
// display correctly rather than picking just one arbitrarily.
export interface PlayerEntryStatus {
	division: string;
	status: Enums<'player_status'>;
}

export interface UserOption {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
}

export const load: PageServerLoad = async ({ params, parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: player, error: playerError } = await supabase
		.from('players')
		.select('id, slug, first_name, last_name, preferences, flight, handicap_index, user_id')
		.eq('tournament_id', tournament.id)
		.eq('slug', params.playerSlug)
		.maybeSingle();
	if (playerError) {
		error(500, playerError.message);
	}
	if (!player) {
		error(404, 'Player not found');
	}

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select('division, status')
		.eq('player_id', player.id)
		.order('division');
	if (entriesError) {
		error(500, entriesError.message);
	}

	let linkedUser: UserOption | null = null;
	if (player.user_id) {
		const { data } = await supabase
			.from('users')
			.select('id, email, first_name, last_name')
			.eq('id', player.user_id)
			.maybeSingle();
		linkedUser = data;
	}

	// A small club roster — a plain list is enough for the link dropdown,
	// no search/autocomplete needed yet. Excludes users already linked to a
	// *different* player in this tournament (unique per (tournamentId,
	// userId) — see the players migration) so the dropdown can't offer a
	// choice that's guaranteed to fail.
	const { data: takenLinks } = await supabase
		.from('players')
		.select('user_id')
		.eq('tournament_id', tournament.id)
		.not('user_id', 'is', null)
		.neq('id', player.id);
	const takenUserIds = new Set((takenLinks ?? []).map((row) => row.user_id));

	const { data: users } = await supabase
		.from('users')
		.select('id, email, first_name, last_name')
		.order('email');

	return {
		tournament,
		player: player as Player,
		entries: (entries as PlayerEntryStatus[] | null) ?? [],
		linkedUser,
		users: ((users as UserOption[] | null) ?? []).filter((user) => !takenUserIds.has(user.id)),
		title: `Edit ${formatPlayerName(player)} · ${tournament.name} · EMGC Bet`,
		description: `Edit ${formatPlayerName(player)}'s roster entry in ${tournament.name}.`
	};
};

export const actions: Actions = {
	link: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const userId = String(formData.get('userId') ?? '');
		if (!userId) {
			return fail(400, { error: 'Choose a participant to link' });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const { data: player } = await supabase
			.from('players')
			.select('id')
			.eq('tournament_id', tournament.id)
			.eq('slug', params.playerSlug)
			.maybeSingle();
		if (!player) {
			return fail(404, { error: 'Player not found' });
		}

		// A golfer is one players row now (Phase 11) — no sibling row to link
		// in step, unlike before the split when a Championship golfer was two
		// independent rows with no shared identity to join on.
		const { error: updateError } = await supabase
			.from('players')
			.update({ user_id: userId })
			.eq('id', player.id);
		if (updateError) {
			// The dropdown already excludes taken links (see load), but this stays
			// as defense in depth — e.g. two Admins editing at once — rather than
			// surfacing Postgres's raw constraint-name error.
			const message =
				updateError.code === '23505'
					? 'That participant is already linked to another player in this tournament.'
					: updateError.message;
			return fail(400, { error: message });
		}
	},

	unlink: async ({ params, locals: { supabase } }) => {
		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const { data: player } = await supabase
			.from('players')
			.select('id')
			.eq('tournament_id', tournament.id)
			.eq('slug', params.playerSlug)
			.maybeSingle();
		if (!player) {
			return fail(404, { error: 'Player not found' });
		}

		// A golfer is one players row now (Phase 11) — no sibling row to
		// unlink in step, unlike before the split.
		const { error: updateError } = await supabase
			.from('players')
			.update({ user_id: null })
			.eq('id', player.id);
		if (updateError) {
			return fail(400, { error: updateError.message });
		}
	},

	updateDetails: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const { data, errors } = parsePlayerForm(formData);
		if (!data) {
			return fail(400, { errors, values: Object.fromEntries(formData) });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, {
				errors: { form: 'Tournament not found' },
				values: Object.fromEntries(formData)
			});
		}

		// Deliberately doesn't touch slug — like tournaments, a Player's slug
		// is set once at creation and edited explicitly if ever needed, not
		// silently regenerated when the name changes.
		const { error: updateError } = await supabase
			.from('players')
			.update(data)
			.eq('tournament_id', tournament.id)
			.eq('slug', params.playerSlug);
		if (updateError) {
			return fail(400, {
				errors: { form: updateError.message },
				values: Object.fromEntries(formData)
			});
		}
	},

	remove: async ({ params, locals: { supabase } }) => {
		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const { error: deleteError } = await supabase
			.from('players')
			.delete()
			.eq('tournament_id', tournament.id)
			.eq('slug', params.playerSlug);
		if (deleteError) {
			return fail(400, { error: deleteError.message });
		}

		redirect(303, `/admin/tournaments/${params.slug}/players`);
	}
};
