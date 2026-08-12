import { error, fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Enums } from '@emgc-calcutta/shared-types';
import { parsePageSize } from '$lib/pagination';
import {
	buildCursorPage,
	cursorFilterExpression,
	decodeCursor,
	encodeCursor,
	parseCursorDirection
} from '$lib/server/cursorPagination';
import type { Actions, PageServerLoad } from './$types';

// One row per player_entries row (Phase 11) — see FieldPlayerRow
// (tournaments/[slug]/+page.server.ts) for the same shape and reasoning.
export type LiveAdminPlayer = {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	handicap_index: number | null;
	status: Enums<'player_status'>;
	user_id: string | null;
	is_field: boolean;
	field_entry_id: string | null;
};

// One row per not-yet-opened live_lots row — `id` is the lot's own id,
// `player.id` is the entry's id (matches live_lots.entry_id, not
// players.id). Phase 32: merged in from the former standalone queue-management
// screen so the reorderable queue and the current-lot controls share one
// page — the current lot / next-queued lot above are still derived
// client-side from the Realtime store (this table doesn't need that same
// live reactivity; it's a deliberate management action screen, refreshed
// via the same invalidateAll() every action here already triggers).
export type QueuePlayer = {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	handicap_index: number | null;
	is_field: boolean;
};

export interface QueueLot {
	id: string;
	queue_position: number;
	player: QueuePlayer;
}

// Phase 32: for the admin-on-behalf-of-participant bid panel embedded at
// the top of this page (AdminBidForm) — every participant with a roster
// entry in this tournament, since place-bid's own roster-membership check
// means anyone else would just fail server-side.
export interface AdminBidParticipant {
	id: string;
	name: string;
	email: string;
}

// Phase 36: null only in the defensive case where a live-phase bid's entry
// somehow has no live_lots row at all — shouldn't happen (an entry can only
// receive a live bid once it has an open lot, per place-bid's own
// validation), but this mirrors the rest of the codebase's "fail soft
// rather than assume" bias for exactly that kind of shouldn't-happen gap.
export type LiveLotState = 'not_yet_opened' | 'open' | 'closed';

export interface LiveAuctionBidRow {
	id: string;
	amount: number;
	placed_at: string;
	voided_at: string | null;
	void_reason: string | null;
	bidder_name: string | null;
	placed_by_admin_id: string | null;
	division: string;
	player: { slug: string; first_name: string; last_name: string };
	lot_state: LiveLotState | null;
}

export interface LiveBidFilters {
	player: string;
	bidder: string;
}

function parseLiveBidFilters(url: URL): LiveBidFilters {
	return {
		player: url.searchParams.get('player')?.trim() ?? '',
		bidder: url.searchParams.get('bidder')?.trim() ?? ''
	};
}

export const load: PageServerLoad = async ({ url, parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: entries } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, field_entry_id, players(slug, first_name, last_name, flight, handicap_index, user_id, is_field)'
		)
		.eq('tournament_id', tournament.id);

	const players: LiveAdminPlayer[] = (entries ?? [])
		.flatMap((entry) =>
			entry.players
				? [
						{
							id: entry.id,
							slug: entry.players.slug,
							first_name: entry.players.first_name,
							last_name: entry.players.last_name,
							flight: entry.players.flight,
							division: entry.division,
							handicap_index: entry.players.handicap_index,
							status: entry.status,
							user_id: entry.players.user_id,
							is_field: entry.players.is_field,
							field_entry_id: entry.field_entry_id
						}
					]
				: []
		)
		.sort(
			(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
		);

	// Only not-yet-opened lots belong in the reorderable queue table — once
	// a lot is opened it's moved on to the current-lot card above, and
	// reordering/removing it here would be nonsensical (it's already
	// resolved).
	const { data: lots, error: lotsError } = await supabase
		.from('live_lots')
		.select('id, queue_position, entry_id')
		.eq('tournament_id', tournament.id)
		.is('opened_at', null)
		.order('queue_position');
	if (lotsError) {
		error(500, lotsError.message);
	}

	const lotEntryIds = (lots ?? []).map((lot) => lot.entry_id);

	const { data: lotEntries, error: lotEntriesError } =
		lotEntryIds.length > 0
			? await supabase
					.from('player_entries')
					.select(
						'id, division, players(slug, first_name, last_name, flight, handicap_index, is_field)'
					)
					.in('id', lotEntryIds)
			: {
					data: [] as { id: string; division: string; players: QueuePlayer | null }[],
					error: null
				};
	if (lotEntriesError) {
		error(500, lotEntriesError.message);
	}

	const entriesById = new Map(
		(lotEntries ?? []).flatMap((entry) =>
			entry.players
				? [
						[
							entry.id,
							{
								id: entry.id,
								slug: entry.players.slug,
								first_name: entry.players.first_name,
								last_name: entry.players.last_name,
								flight: entry.players.flight,
								division: entry.division,
								handicap_index: entry.players.handicap_index,
								is_field: entry.players.is_field
							}
						] as const
					]
				: []
		)
	);

	// Skips any lot whose entry can't be found rather than throwing — can't
	// happen today (entry_id has no ON DELETE cascade, see the
	// create_live_lots migration), but failing soft here is cheap insurance
	// against a future data inconsistency hiding the whole queue behind a
	// 500.
	const queue: QueueLot[] = (lots ?? []).flatMap((lot) => {
		const player = entriesById.get(lot.entry_id);
		return player ? [{ id: lot.id, queue_position: lot.queue_position, player }] : [];
	});

	const { data: rosterRows, error: rosterError } = await supabase
		.from('players')
		.select('user_id, users(id, first_name, last_name, email)')
		.eq('tournament_id', tournament.id)
		.not('user_id', 'is', null);
	if (rosterError) {
		error(500, rosterError.message);
	}

	const participantsById = new Map<string, AdminBidParticipant>();
	for (const row of rosterRows ?? []) {
		if (!row.users) continue;
		participantsById.set(row.users.id, {
			id: row.users.id,
			name:
				[row.users.first_name, row.users.last_name].filter(Boolean).join(' ') || row.users.email,
			email: row.users.email
		});
	}
	const participants = [...participantsById.values()].sort((a, b) => a.name.localeCompare(b.name));

	// Phase 36: "Recent live auction bids" review/void table — same cursor-
	// pagination + server-side search shape Phase 35 already established for
	// Silent Auction Bids, sorted by placed_at instead of created_at. See
	// SilentBidFilters/queryEvents in auction/silent/+page.server.ts for the
	// identical player-search two-step-lookup reasoning.
	const bidFilters = parseLiveBidFilters(url);
	const bidPageSize = parsePageSize(url.searchParams.get('page_size'));
	const bidDirection = parseCursorDirection(url.searchParams.get('dir'));
	const bidCursor = decodeCursor(url.searchParams.get('cursor'));
	const bidAscending = bidDirection === 'after';

	let liveBidsQuery = supabase
		.from('bids')
		.select(
			`id, amount, placed_at, voided_at, void_reason, bidder_name, placed_by_admin_id, entry_id,
			player_entries!bids_entry_id_fkey!inner(tournament_id, division, players(slug, first_name, last_name))`
		)
		.eq('player_entries.tournament_id', tournament.id)
		.eq('phase', 'live')
		.order('placed_at', { ascending: bidAscending })
		.order('id', { ascending: bidAscending })
		.limit(bidPageSize + 1);

	if (bidCursor) {
		liveBidsQuery = liveBidsQuery.or(cursorFilterExpression(bidCursor, bidDirection, 'placed_at'));
	}
	if (bidFilters.bidder) {
		liveBidsQuery = liveBidsQuery.ilike('bidder_name', `%${bidFilters.bidder}%`);
	}
	if (bidFilters.player) {
		const { data: matchingPlayers, error: playersError } = await supabase
			.from('players')
			.select('id')
			.eq('tournament_id', tournament.id)
			.or(`first_name.ilike.%${bidFilters.player}%,last_name.ilike.%${bidFilters.player}%`);
		if (playersError) {
			error(500, playersError.message);
		}
		const ids = (matchingPlayers ?? []).map((p) => p.id);
		liveBidsQuery = liveBidsQuery.in(
			'player_entries.player_id',
			ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']
		);
	}

	const { data: liveBids, error: liveBidsError } = await liveBidsQuery;
	if (liveBidsError) {
		error(500, liveBidsError.message);
	}

	const {
		rows: liveBidRows,
		hasNext: bidsHasNext,
		hasPrev: bidsHasPrev
	} = buildCursorPage(liveBids ?? [], bidDirection, bidCursor !== null, bidPageSize);

	// Lot state per bid — the whole reason it's worth calling out separately
	// from an ordinary void (see void-bid/index.ts's own header comment): a
	// bid on a still-open (or not-yet-opened) lot needs no special handling
	// when voided (place-bid/close_live_lot's own high-bid lookups already
	// exclude voided bids), but voiding a *closed* lot's winning bid
	// recomputes the winner immediately. One live_lots row per entry ever
	// (see live_lots' own migration comment), so a plain Map is safe here —
	// fetched unconditionally (not just not-yet-opened, unlike the queue
	// query above) since a bid can belong to a lot in any of the three
	// states.
	const bidEntryIds = liveBidRows.map((bid) => bid.entry_id);
	const { data: bidLots, error: bidLotsError } =
		bidEntryIds.length > 0
			? await supabase
					.from('live_lots')
					.select('entry_id, opened_at, closed_at')
					.in('entry_id', bidEntryIds)
			: { data: [], error: null };
	if (bidLotsError) {
		error(500, bidLotsError.message);
	}
	const lotStateByEntryId = new Map<string, LiveLotState>(
		(bidLots ?? []).map((lot) => [
			lot.entry_id,
			lot.closed_at ? 'closed' : lot.opened_at ? 'open' : 'not_yet_opened'
		])
	);

	const liveAuctionBids: LiveAuctionBidRow[] = liveBidRows.flatMap((bid) =>
		bid.player_entries?.players
			? [
					{
						id: bid.id,
						amount: bid.amount,
						placed_at: bid.placed_at,
						voided_at: bid.voided_at,
						void_reason: bid.void_reason,
						bidder_name: bid.bidder_name,
						placed_by_admin_id: bid.placed_by_admin_id,
						division: bid.player_entries.division,
						player: bid.player_entries.players,
						lot_state: lotStateByEntryId.get(bid.entry_id) ?? null
					}
				]
			: []
	);

	return {
		tournament,
		players,
		queue,
		participants,
		liveBids: liveAuctionBids,
		liveBidFilters: bidFilters,
		liveBidPageSize: bidPageSize,
		liveBidsHasNext: bidsHasNext,
		liveBidsHasPrev: bidsHasPrev,
		liveBidsNextCursor:
			bidsHasNext && liveBidRows.length > 0
				? encodeCursor({
						sortValue: liveBidRows[liveBidRows.length - 1].placed_at,
						id: liveBidRows[liveBidRows.length - 1].id
					})
				: null,
		liveBidsPrevCursor:
			bidsHasPrev && liveBidRows.length > 0
				? encodeCursor({ sortValue: liveBidRows[0].placed_at, id: liveBidRows[0].id })
				: null,
		title: `${tournament.name} · Live auction · EMGC Bet`,
		description: `Run the live auction for ${tournament.name}.`
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
		.select('id, entry_id')
		.eq('tournament_id', tournamentId)
		.is('opened_at', null);
	if (lotsError || !lots) {
		return null;
	}

	const entryIds = lots.map((lot) => lot.entry_id);
	const { data: entries, error: entriesError } =
		entryIds.length > 0
			? await supabase
					.from('player_entries')
					.select('id, players(handicap_index)')
					.in('id', entryIds)
			: {
					data: [] as { id: string; players: { handicap_index: number | null } | null }[],
					error: null
				};
	if (entriesError || !entries) {
		return null;
	}

	const handicapByEntryId = new Map(
		entries.map((entry) => [entry.id, entry.players?.handicap_index ?? null])
	);
	return lots.map((lot) => ({
		id: lot.id,
		handicap_index: handicapByEntryId.get(lot.entry_id) ?? null
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
	advance: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const lotId = String(formData.get('lotId') ?? '');
		if (!lotId) {
			return fail(400, { error: 'Missing lot' });
		}

		const { error: openError } = await supabase.rpc('open_live_lot', { lot_id: lotId });
		if (openError) {
			return fail(400, { error: openError.message });
		}
	},

	close: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const lotId = String(formData.get('lotId') ?? '');
		if (!lotId) {
			return fail(400, { error: 'Missing lot' });
		}

		const { error: closeError } = await supabase.rpc('close_live_lot', { lot_id: lotId });
		if (closeError) {
			return fail(400, { error: closeError.message });
		}
	},

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

		// Need the entry before the lot row is gone, to revert its status
		// below.
		const { data: lot } = await supabase
			.from('live_lots')
			.select('entry_id')
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
		// task), so this un-reserved entry is picked up by the existing
		// close_silent_auctions() cron and swept to sold_silent on its next
		// run, same as any other entry who never crossed the threshold.
		const { error: revertError } = await supabase
			.from('player_entries')
			.update({ status: 'open' })
			.eq('id', lot.entry_id);
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
