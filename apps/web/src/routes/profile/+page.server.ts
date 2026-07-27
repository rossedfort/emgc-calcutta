import { error, fail, redirect } from '@sveltejs/kit';
import type { UserProfile } from '$lib/profile';
import type { Actions, PageServerLoad } from './$types';

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

	return {
		profile: data as UserProfile,
		title: 'Profile · EMGC Calcutta',
		description: 'Your EMGC Calcutta account details.'
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
	default: async ({ request, locals: { session, supabase } }) => {
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
	}
};
