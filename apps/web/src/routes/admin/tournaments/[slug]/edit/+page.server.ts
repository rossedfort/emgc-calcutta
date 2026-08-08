import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseTournamentForm } from '../../shared';

export const load: PageServerLoad = async ({ parent }) => {
	const { tournament } = await parent();
	return {
		title: `Edit ${tournament.name} · EMGC Bet`,
		description: `Configure auction timing, thresholds, and payout structure for ${tournament.name}.`
	};
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
			.eq('slug', params.slug);
		if (updateError) {
			return fail(400, {
				errors: { form: updateError.message },
				values: Object.fromEntries(formData)
			});
		}

		redirect(303, `/admin/tournaments/${params.slug}`);
	}
};
