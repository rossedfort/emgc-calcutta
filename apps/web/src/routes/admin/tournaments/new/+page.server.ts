import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { parseTournamentForm } from '../shared';

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
