import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	// RLS scopes this: a tournament a Participant can't see (a dry run) or a
	// typo'd slug both resolve to no rows here — a 404, not a 403, so this
	// doesn't leak which slugs exist.
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

	return {
		tournament,
		currentUserId: session.user.id,
		// Fallback for the Auction tab (its own +page.server.ts has no title
		// of its own now that it matches this exactly) — every other tab
		// under this layout overrides this with something more specific.
		title: `${tournament.name} · EMGC Bet`,
		description: `Browse the field and bid in the ${tournament.name} auction.`
	};
};
