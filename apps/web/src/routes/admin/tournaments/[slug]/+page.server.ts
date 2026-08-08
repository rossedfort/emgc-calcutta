import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { tournament } = await parent();
	return {
		title: `${tournament.name} · Settings · EMGC Bet`,
		description: `Configure auction timing, thresholds, and payout structure for ${tournament.name}.`
	};
};

export const actions: Actions = {
	// Separate from startLiveAuction below so a one-way action doesn't ride
	// along with an unrelated status change. Deliberately unrestricted
	// transitions between all three statuses (no "back" limitation) — no DB
	// constraint caps how many tournaments can be active concurrently,
	// matching the true multi-tenancy decision.
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
	},

	// Separate from setStatus for the same reason — start_live_auction (the
	// RPC) is the authoritative gate (silent auction must have already
	// ended, and this can only run once) — this action just surfaces its
	// error message.
	startLiveAuction: async ({ params, locals: { supabase } }) => {
		const { data: tournament, error: tournamentError } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (tournamentError || !tournament) {
			return fail(404, { liveAuctionError: tournamentError?.message ?? 'Tournament not found' });
		}

		const { error: rpcError } = await supabase.rpc('start_live_auction', {
			tournament_id: tournament.id
		});
		if (rpcError) {
			return fail(400, { liveAuctionError: rpcError.message });
		}
	}
};
