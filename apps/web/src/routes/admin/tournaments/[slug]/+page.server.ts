import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { parseTournamentForm } from '../shared';

export const actions: Actions = {
	// Named (not `default`) because it coexists with the `setStatus` action
	// below — SvelteKit doesn't allow mixing a default action with named ones.
	updateSettings: async ({ request, params, locals: { supabase } }) => {
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
	},

	// Separate from the main settings form so switching status doesn't
	// require re-submitting (and re-validating) name/dates/thresholds too.
	// Deliberately unrestricted transitions between all three statuses (no
	// "back" limitation) — no DB constraint caps how many tournaments can be
	// active concurrently, matching the true multi-tenancy decision.
	setStatus: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const status = String(formData.get('status') ?? '');
		if (!['setup', 'active', 'complete'].includes(status)) {
			return fail(400, { statusError: 'Invalid status' });
		}

		const { error: updateError } = await supabase
			.from('tournaments')
			.update({ status })
			.eq('slug', params.slug);
		if (updateError) {
			return fail(400, { statusError: updateError.message });
		}
	}
};
