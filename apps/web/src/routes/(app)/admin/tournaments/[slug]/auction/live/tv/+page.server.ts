import { error, redirect } from '@sveltejs/kit';
import type { WhoamiResponse } from '@emgc-calcutta/shared-types';
import { loadFieldPlayers } from '$lib/server/fieldPlayers';
import type { Tournament } from '../../../../shared';
import type { PageServerLoad } from './$types';

export type { FieldPlayerRow } from '$lib/server/fieldPlayers';

// This route resets its rendered layout all the way to root (see
// +page@.svelte in this directory) so the app shell/admin chrome doesn't
// show on the TV. That reset turns out to skip the *load* chain too, not
// just the component tree — confirmed empirically via this file's own
// generated $types.d.ts, whose PageServerParentData resolves straight to
// root's LayoutServerData rather than admin/+layout.server.ts's or
// admin/tournaments/[slug]/+layout.server.ts's. So the admin/owner role
// check and the tournament-by-slug fetch every other admin page gets for
// free from those ancestors have to be redone here explicitly — this page
// is not actually protected by admin/+layout.server.ts despite living
// under admin/tournaments/[slug]/auction/live/.
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
		// Non-null: the session check above already redirected otherwise.
		currentUserId: session.user.id,
		title: `${tournament.name} · TV Display · EMGC Bet`,
		description: `Live auction TV display for ${tournament.name}.`
	};
};
