import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { parsePlayerForm } from '../shared';

export const actions: Actions = {
	default: async ({ request, params, locals: { supabase } }) => {
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

		const { error: insertError } = await supabase
			.from('players')
			.insert({ tournament_id: tournament.id, ...data });
		if (insertError) {
			return fail(400, {
				errors: { form: insertError.message },
				values: Object.fromEntries(formData)
			});
		}

		redirect(303, `/admin/tournaments/${params.slug}/players`);
	}
};
