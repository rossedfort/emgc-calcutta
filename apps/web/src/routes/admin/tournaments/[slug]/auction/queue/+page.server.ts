import { error, fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@emgc-calcutta/shared-types';
import type { Actions, PageServerLoad } from './$types';

export type QueuePlayer = Pick<
	Tables<'players'>,
	'id' | 'slug' | 'first_name' | 'last_name' | 'flight' | 'division' | 'handicap_index'
>;

export interface QueueLot {
	id: string;
	queue_position: number;
	player: QueuePlayer;
}

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	// Only not-yet-opened lots belong on this pre-event queue-management
	// screen — once the live auction is underway, an already-opened/closed
	// lot has moved on to the live-auction admin screen instead, and
	// reordering/removing it here would be nonsensical (it's already
	// resolved). Matters starting Phase 4.5: before sequential auction
	// phases, this page was only ever visited before any lot could be
	// opened, so the gap was latent, not reachable.
	const { data: lots, error: lotsError } = await supabase
		.from('live_lots')
		.select('id, queue_position, player_id')
		.eq('tournament_id', tournament.id)
		.is('opened_at', null)
		.order('queue_position');
	if (lotsError) {
		error(500, lotsError.message);
	}

	const lotPlayerIds = (lots ?? []).map((lot) => lot.player_id);

	const { data: lotPlayers, error: lotPlayersError } =
		lotPlayerIds.length > 0
			? await supabase
					.from('players')
					.select('id, slug, first_name, last_name, flight, division, handicap_index')
					.in('id', lotPlayerIds)
			: { data: [] as QueuePlayer[], error: null };
	if (lotPlayersError) {
		error(500, lotPlayersError.message);
	}

	const playersById = new Map((lotPlayers ?? []).map((player) => [player.id, player]));

	// Skips any lot whose player row is missing rather than throwing — can't
	// happen today (player_id has no ON DELETE cascade, see the create_live_lots
	// migration), but failing soft here is cheap insurance against a future
	// data inconsistency hiding the whole queue behind a 500.
	const queue: QueueLot[] = (lots ?? []).flatMap((lot) => {
		const player = playersById.get(lot.player_id);
		return player ? [{ id: lot.id, queue_position: lot.queue_position, player }] : [];
	});

	return {
		tournament,
		queue,
		title: `${tournament.name} · Live auction queue · EMGC Calcutta`,
		description: `Manage the live auction lot order for ${tournament.name}.`
	};
};

// Shared by the moveUp/moveDown actions below: finds the lot immediately
// before (direction: 'up') or after (direction: 'down') the given one in
// queue_position order, then swaps them via the swap_queue_position RPC —
// a single-statement swap under a plain unique constraint isn't possible
// (verified directly: the first of two sequential UPDATEs collides with
// whichever row still holds the target value), so
// live_lots_tournament_id_queue_position_key is deferrable specifically to
// make this RPC's two-statement swap work within one transaction.
async function moveLot(
	supabase: SupabaseClient<Database>,
	tournamentId: string,
	lotId: string,
	direction: 'up' | 'down'
): Promise<string | null> {
	const { data: currentLot } = await supabase
		.from('live_lots')
		.select('id, queue_position')
		.eq('id', lotId)
		.eq('tournament_id', tournamentId)
		.is('opened_at', null)
		.maybeSingle();
	if (!currentLot) {
		return 'Lot not found';
	}

	const { data: adjacentLot } =
		direction === 'up'
			? await supabase
					.from('live_lots')
					.select('id')
					.eq('tournament_id', tournamentId)
					.is('opened_at', null)
					.lt('queue_position', currentLot.queue_position)
					.order('queue_position', { ascending: false })
					.limit(1)
					.maybeSingle()
			: await supabase
					.from('live_lots')
					.select('id')
					.eq('tournament_id', tournamentId)
					.is('opened_at', null)
					.gt('queue_position', currentLot.queue_position)
					.order('queue_position', { ascending: true })
					.limit(1)
					.maybeSingle();

	// Already at the front/back of the queue — a no-op, not an error.
	if (!adjacentLot) {
		return null;
	}

	const { error: swapError } = await supabase.rpc('swap_queue_position', {
		lot_a: currentLot.id,
		lot_b: adjacentLot.id
	});
	return swapError ? swapError.message : null;
}

// Shared by the three sort presets below: re-fetches the current
// not-yet-opened queue fresh (rather than trusting whatever the client
// last rendered) so the sort is computed against up-to-the-moment state —
// resequence_queue itself also re-validates this against the DB, but
// there's no point handing it a list that's already stale by construction.
async function fetchSortableQueue(
	supabase: SupabaseClient<Database>,
	tournamentId: string
): Promise<{ id: string; handicap_index: number | null }[] | null> {
	const { data: lots, error: lotsError } = await supabase
		.from('live_lots')
		.select('id, player_id')
		.eq('tournament_id', tournamentId)
		.is('opened_at', null);
	if (lotsError || !lots) {
		return null;
	}

	const playerIds = lots.map((lot) => lot.player_id);
	const { data: players, error: playersError } =
		playerIds.length > 0
			? await supabase.from('players').select('id, handicap_index').in('id', playerIds)
			: { data: [] as { id: string; handicap_index: number | null }[], error: null };
	if (playersError || !players) {
		return null;
	}

	const handicapByPlayerId = new Map(players.map((player) => [player.id, player.handicap_index]));
	return lots.map((lot) => ({
		id: lot.id,
		handicap_index: handicapByPlayerId.get(lot.player_id) ?? null
	}));
}

// Nulls (no handicap on record) always sort last regardless of direction —
// "unknown" isn't meaningfully high or low, it's just not enough
// information to place relative to the rest.
function sortByHandicap(
	queue: { id: string; handicap_index: number | null }[],
	direction: 'asc' | 'desc'
): string[] {
	return [...queue]
		.sort((a, b) => {
			if (a.handicap_index === null) return 1;
			if (b.handicap_index === null) return -1;
			return direction === 'asc'
				? a.handicap_index - b.handicap_index
				: b.handicap_index - a.handicap_index;
		})
		.map((lot) => lot.id);
}

function shuffle<T>(items: T[]): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

export const actions: Actions = {
	// Every reserved player is queued automatically by place-bid the moment
	// they cross the threshold (see enqueue_player_for_live_auction) — there's
	// no manual "add" step anymore.
	remove: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const lotId = String(formData.get('lotId') ?? '');
		if (!lotId) {
			return fail(400, { error: 'Missing lot' });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		// Need the player before the lot row is gone, to revert their status
		// below.
		const { data: lot } = await supabase
			.from('live_lots')
			.select('player_id')
			.eq('id', lotId)
			.eq('tournament_id', tournament.id)
			.is('opened_at', null)
			.maybeSingle();
		if (!lot) {
			return fail(404, { error: 'Lot not found' });
		}

		const { error: deleteError } = await supabase
			.from('live_lots')
			.delete()
			.eq('id', lotId)
			.eq('tournament_id', tournament.id);
		if (deleteError) {
			return fail(400, { error: deleteError.message });
		}

		// Revert to 'open' rather than leaving them 'reserved'-but-unqueued —
		// the silent auction has necessarily already ended by the time an
		// Admin is looking at this screen (the silent auction always
		// precedes the live one now, see the "Sequential auction phases"
		// task), so this un-reserved player is picked up by the existing
		// close_silent_auctions() cron and swept to sold_silent on its next
		// run, same as any other player who never crossed the threshold.
		const { error: revertError } = await supabase
			.from('players')
			.update({ status: 'open' })
			.eq('id', lot.player_id);
		if (revertError) {
			return fail(400, { error: revertError.message });
		}
	},

	moveUp: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const lotId = String(formData.get('lotId') ?? '');
		if (!lotId) {
			return fail(400, { error: 'Missing lot' });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const moveError = await moveLot(supabase, tournament.id, lotId, 'up');
		if (moveError) {
			return fail(400, { error: moveError });
		}
	},

	moveDown: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const lotId = String(formData.get('lotId') ?? '');
		if (!lotId) {
			return fail(400, { error: 'Missing lot' });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const moveError = await moveLot(supabase, tournament.id, lotId, 'down');
		if (moveError) {
			return fail(400, { error: moveError });
		}
	},

	sortHandicapAsc: async ({ params, locals: { supabase } }) => {
		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const queue = await fetchSortableQueue(supabase, tournament.id);
		if (!queue) {
			return fail(500, { error: 'Could not load the queue to sort it' });
		}

		const { error: sortError } = await supabase.rpc('resequence_queue', {
			p_tournament_id: tournament.id,
			p_ordered_lot_ids: sortByHandicap(queue, 'asc')
		});
		if (sortError) {
			return fail(400, { error: sortError.message });
		}
	},

	sortHandicapDesc: async ({ params, locals: { supabase } }) => {
		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const queue = await fetchSortableQueue(supabase, tournament.id);
		if (!queue) {
			return fail(500, { error: 'Could not load the queue to sort it' });
		}

		const { error: sortError } = await supabase.rpc('resequence_queue', {
			p_tournament_id: tournament.id,
			p_ordered_lot_ids: sortByHandicap(queue, 'desc')
		});
		if (sortError) {
			return fail(400, { error: sortError.message });
		}
	},

	sortShuffle: async ({ params, locals: { supabase } }) => {
		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const queue = await fetchSortableQueue(supabase, tournament.id);
		if (!queue) {
			return fail(500, { error: 'Could not load the queue to sort it' });
		}

		const { error: sortError } = await supabase.rpc('resequence_queue', {
			p_tournament_id: tournament.id,
			p_ordered_lot_ids: shuffle(queue.map((lot) => lot.id))
		});
		if (sortError) {
			return fail(400, { error: sortError.message });
		}
	}
};
