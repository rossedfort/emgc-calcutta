import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parsePlayerForm } from '../../shared';

export interface Player {
	id: string;
	slug: string;
	name: string;
	contact_email: string | null;
	contact_phone: string | null;
	preferences: string | null;
	flight: string | null;
	status: string;
	user_id: string | null;
}

export interface UserOption {
	id: string;
	email: string;
	name: string | null;
}

export const load: PageServerLoad = async ({ params, parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: player, error: playerError } = await supabase
		.from('players')
		.select('id, slug, name, contact_email, contact_phone, preferences, flight, status, user_id')
		.eq('tournament_id', tournament.id)
		.eq('slug', params.playerSlug)
		.maybeSingle();
	if (playerError) {
		error(500, playerError.message);
	}
	if (!player) {
		error(404, 'Player not found');
	}

	let linkedUser: UserOption | null = null;
	if (player.user_id) {
		const { data } = await supabase
			.from('users')
			.select('id, email, name')
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

	const { data: users } = await supabase.from('users').select('id, email, name').order('email');

	return {
		tournament,
		player: player as Player,
		linkedUser,
		users: ((users as UserOption[] | null) ?? []).filter((user) => !takenUserIds.has(user.id))
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

		const { error: updateError } = await supabase
			.from('players')
			.update({ user_id: userId })
			.eq('tournament_id', tournament.id)
			.eq('slug', params.playerSlug);
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

		const { error: updateError } = await supabase
			.from('players')
			.update({ user_id: null })
			.eq('tournament_id', tournament.id)
			.eq('slug', params.playerSlug);
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
