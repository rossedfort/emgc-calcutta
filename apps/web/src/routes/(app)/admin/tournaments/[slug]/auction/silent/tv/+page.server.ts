import { error, redirect } from '@sveltejs/kit';
import type { WhoamiResponse } from '@emgc-calcutta/shared-types';
import { loadFieldPlayers } from '$lib/server/fieldPlayers';
import type { Tournament } from '../../../../shared';
import type { PageServerLoad } from './$types';

export type { FieldPlayerRow } from '$lib/server/fieldPlayers';

// Same self-contained auth as the live-auction TV route (see its own
// +page.server.ts for the full reasoning) — this route also resets its
// rendered layout to root via +page@.svelte, which skips the ancestor
// admin/+layout.server.ts role check and admin/tournaments/[slug]/
// +layout.server.ts tournament fetch, not just their .svelte rendering.
export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	const { data: whoami, error: whoamiError } =
		await supabase.functions.invoke<WhoamiResponse>('whoami');
	if (whoamiError || !whoami || (whoami.role !== 'admin' && whoami.role !== 'owner')) {
		redirect(303, '/');
	}

	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select('*')
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}

	const players = await loadFieldPlayers(supabase, tournament.id).catch((e: { message: string }) =>
		error(500, e.message)
	);

	return {
		tournament: tournament as Tournament,
		players,
		title: `${tournament.name} · Silent Auction TV Display · EMGC Bet`,
		description: `Live silent auction bid feed for ${tournament.name}.`
	};
};
