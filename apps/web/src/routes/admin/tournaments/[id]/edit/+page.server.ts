import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseTournamentForm, type Tournament } from '../../shared';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data, error: loadError } = await supabase
		.from('tournaments')
		.select('*')
		.eq('id', params.id)
		.maybeSingle();

	if (loadError) {
		error(500, loadError.message);
	}
	if (!data) {
		error(404, 'Tournament not found');
	}

	return { tournament: data as Tournament };
};

export const actions: Actions = {
	default: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const { data, errors } = parseTournamentForm(formData);
		if (!data) {
			return fail(400, { errors, values: Object.fromEntries(formData) });
		}

		const { error: updateError } = await supabase
			.from('tournaments')
			.update(data)
			.eq('id', params.id);
		if (updateError) {
			return fail(400, {
				errors: { form: updateError.message },
				values: Object.fromEntries(formData)
			});
		}

		redirect(303, '/admin/tournaments');
	}
};
