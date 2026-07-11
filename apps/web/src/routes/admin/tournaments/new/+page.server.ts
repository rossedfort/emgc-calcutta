import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseTournamentForm } from '../shared';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	// Spec 3: "a single internal league runs one Tournament at a time" — this
	// UI doesn't support creating a second one, so bounce to the existing
	// tournament's page instead of showing a create form that would just fail
	// the RLS-permitted insert anyway once a unique-tournament rule exists.
	const { data } = await supabase.from('tournaments').select('id').limit(1);
	if (data && data.length > 0) {
		redirect(303, '/admin/tournaments');
	}
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const { data, errors } = parseTournamentForm(formData);
		if (!data) {
			return fail(400, { errors, values: Object.fromEntries(formData) });
		}

		const { error: insertError } = await supabase.from('tournaments').insert(data);
		if (insertError) {
			return fail(400, {
				errors: { form: insertError.message },
				values: Object.fromEntries(formData)
			});
		}

		redirect(303, '/admin/tournaments');
	}
};
