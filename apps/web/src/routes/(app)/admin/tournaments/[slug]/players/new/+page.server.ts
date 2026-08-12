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

		// Two inserts now (Phase 11): the `players` identity row first, then
		// one or two `player_entries` rows (Gross + Net for a Championship-
		// flight player, same rule CSV import applies in
		// import-csv-confirm's flatMap — division isn't a form field, it's
		// always derived from flight vs. the tournament's configured
		// championship_flight). If the second insert fails, the just-created
		// player row is deleted rather than left behind with zero entries —
		// see import-csv-confirm's header comment for why a compensating
		// delete is used here instead of a real transaction.
		const { data: player, error: insertError } = await supabase
			.from('players')
			.insert({ tournament_id: tournament.id, ...data })
			.select('id')
			.single();
		if (insertError) {
			return fail(400, {
				errors: { form: insertError.message },
				values: Object.fromEntries(formData)
			});
		}

		const insertEntries =
			tournament.championship_flight && data.flight === tournament.championship_flight
				? [
						{
							player_id: player.id,
							tournament_id: tournament.id,
							flight: data.flight,
							division: 'gross'
						},
						{
							player_id: player.id,
							tournament_id: tournament.id,
							flight: data.flight,
							division: 'net'
						}
					]
				: [
						{
							player_id: player.id,
							tournament_id: tournament.id,
							flight: data.flight,
							division: 'overall'
						}
					];

		const { error: entriesInsertError } = await supabase
			.from('player_entries')
			.insert(insertEntries);
		if (entriesInsertError) {
			await supabase.from('players').delete().eq('id', player.id);
			return fail(400, {
				errors: { form: entriesInsertError.message },
				values: Object.fromEntries(formData)
			});
		}

		redirect(303, `/admin/tournaments/${params.slug}/players`);
	}
};
