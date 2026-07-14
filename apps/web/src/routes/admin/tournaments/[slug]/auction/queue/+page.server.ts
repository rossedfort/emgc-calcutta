import { error, fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@emgc-calcutta/shared-types';
import type { Actions, PageServerLoad } from './$types';

export type QueuePlayer = Pick<
	Tables<'players'>,
	'id' | 'slug' | 'name' | 'flight' | 'handicap_index'
>;

export interface QueueLot {
	id: string;
	queue_position: number;
	player: QueuePlayer;
}

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: lots, error: lotsError } = await supabase
		.from('live_lots')
		.select('id, queue_position, player_id')
		.eq('tournament_id', tournament.id)
		.order('queue_position');
	if (lotsError) {
		error(500, lotsError.message);
	}

	const lotPlayerIds = (lots ?? []).map((lot) => lot.player_id);

	const { data: lotPlayers, error: lotPlayersError } =
		lotPlayerIds.length > 0
			? await supabase
					.from('players')
					.select('id, slug, name, flight, handicap_index')
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

	const { data: reservedPlayers, error: reservedError } = await supabase
		.from('players')
		.select('id, slug, name, flight, handicap_index')
		.eq('tournament_id', tournament.id)
		.eq('status', 'reserved')
		.order('name');
	if (reservedError) {
		error(500, reservedError.message);
	}

	const queuedPlayerIds = new Set(lotPlayerIds);
	const availablePlayers = (reservedPlayers ?? []).filter(
		(player) => !queuedPlayerIds.has(player.id)
	);

	return { tournament, queue, availablePlayers };
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
					.lt('queue_position', currentLot.queue_position)
					.order('queue_position', { ascending: false })
					.limit(1)
					.maybeSingle()
			: await supabase
					.from('live_lots')
					.select('id')
					.eq('tournament_id', tournamentId)
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

export const actions: Actions = {
	add: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const playerId = String(formData.get('playerId') ?? '');
		if (!playerId) {
			return fail(400, { error: 'Choose a player to add' });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { error: 'Tournament not found' });
		}

		const { data: lastLot } = await supabase
			.from('live_lots')
			.select('queue_position')
			.eq('tournament_id', tournament.id)
			.order('queue_position', { ascending: false })
			.limit(1)
			.maybeSingle();
		const nextPosition = (lastLot?.queue_position ?? 0) + 1;

		const { error: insertError } = await supabase.from('live_lots').insert({
			tournament_id: tournament.id,
			player_id: playerId,
			queue_position: nextPosition
		});
		if (insertError) {
			return fail(400, { error: insertError.message });
		}
	},

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

		const { error: deleteError } = await supabase
			.from('live_lots')
			.delete()
			.eq('id', lotId)
			.eq('tournament_id', tournament.id);
		if (deleteError) {
			return fail(400, { error: deleteError.message });
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
	}
};
