import { error, fail, redirect } from '@sveltejs/kit';
import type { UserProfile } from '$lib/profile';
import type { Actions, PageServerLoad } from './$types';

export interface LinkedTournament {
	playerId: string;
	playerName: string;
	tournamentSlug: string;
	tournamentName: string;
}

export const load: PageServerLoad = async ({ locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	const { data, error: queryError } = await supabase
		.from('users')
		.select('first_name, last_name, email, avatar_url, role')
		.eq('id', session.user.id)
		.single();

	if (queryError || !data) {
		error(500, queryError?.message ?? 'Failed to load profile');
	}

	// Every Player row this User is currently linked to, across every
	// tournament they can see (RLS scopes this to production tournaments,
	// same as everywhere else a Participant reads players) — a link is
	// per-tournament (and per-division for a Championship flight golfer), so
	// this can be more than one row. Powers the unlink list below.
	const { data: linkedPlayers, error: linkedError } = await supabase
		.from('players')
		.select('id, first_name, last_name, tournaments(slug, name)')
		.eq('user_id', session.user.id);
	if (linkedError) {
		error(500, linkedError.message);
	}

	return {
		profile: data as UserProfile,
		linkedTournaments: (linkedPlayers ?? []).map((p): LinkedTournament => ({
			playerId: p.id,
			playerName: `${p.first_name} ${p.last_name}`,
			tournamentSlug: p.tournaments!.slug,
			tournamentName: p.tournaments!.name
		})),
		title: 'Profile · EMGC Bet',
		description: 'Your EMGC Bet account details.'
	};
};

export const actions: Actions = {
	// Saves first_name/last_name only — email/avatar/role aren't editable
	// here (email changes go through Supabase Auth's own flow, role is
	// Owner/Admin-managed via /admin/users). Writes through the caller's own
	// session, not service-role: the users_update_self RLS policy plus a
	// first_name/last_name-only column grant (see the migration) is what
	// makes this safe without an Edge Function, matching this codebase's
	// "basic form validation doesn't need service-role" precedent.
	updateProfile: async ({ request, locals: { session, supabase } }) => {
		if (!session) {
			redirect(303, '/login');
		}

		const form = await request.formData();
		const first_name = (form.get('first_name') as string | null)?.trim() ?? '';
		const last_name = (form.get('last_name') as string | null)?.trim() ?? '';

		if (!first_name || !last_name) {
			return fail(400, {
				error: 'First and last name are both required.',
				first_name,
				last_name
			});
		}

		const { error: updateError } = await supabase
			.from('users')
			.update({ first_name, last_name })
			.eq('id', session.user.id);

		if (updateError) {
			return fail(500, { error: updateError.message, first_name, last_name });
		}

		redirect(303, '/');
	},

	// Self-service unlinking — unlink_self_from_player is SECURITY DEFINER
	// for the same reason link_self_to_player is (see its migration): an
	// ordinary Participant has no RLS UPDATE grant on players at all, only
	// Admin/Owner do.
	unlink: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const playerId = String(formData.get('playerId') ?? '');
		if (!playerId) {
			return fail(400, { unlinkError: 'Missing player' });
		}

		const { error: unlinkError } = await supabase.rpc('unlink_self_from_player', {
			p_player_id: playerId
		});
		if (unlinkError) {
			return fail(400, { unlinkError: unlinkError.message });
		}
	}
};
