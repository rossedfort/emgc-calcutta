import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parsePlayerForm } from '../shared';

export const load: PageServerLoad = async ({ parent }) => {
	const { tournament } = await parent();
	return {
		title: `New player · ${tournament.name} · EMGC Bet`,
		description: `Add a new player to the ${tournament.name} roster.`
	};
};

export const actions: Actions = {
	default: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const { data, errors } = parsePlayerForm(formData);
		if (!data) {
			return fail(400, { errors, values: Object.fromEntries(formData) });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id, championship_flight')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, {
				errors: { form: 'Tournament not found' },
				values: Object.fromEntries(formData)
			});
		}

		// A Championship-flight player is auctioned twice (Gross + Net) — same
		// rule CSV import applies in import-csv-confirm's flatMap. Division
		// isn't a form field; it's always derived from flight vs. the
		// tournament's configured championship_flight.
		const insertRows =
			tournament.championship_flight && data.flight === tournament.championship_flight
				? [
						{ tournament_id: tournament.id, ...data, division: 'gross' },
						{ tournament_id: tournament.id, ...data, division: 'net' }
					]
				: [{ tournament_id: tournament.id, ...data, division: 'overall' }];

		const { error: insertError } = await supabase.from('players').insert(insertRows);
		if (insertError) {
			return fail(400, {
				errors: { form: insertError.message },
				values: Object.fromEntries(formData)
			});
		}

		redirect(303, `/admin/tournaments/${params.slug}/players`);
	}
};
