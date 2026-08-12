import { error } from '@sveltejs/kit';
import { parsePageSize } from '$lib/pagination';
import {
	buildCursorPage,
	cursorFilterExpression,
	decodeCursor,
	encodeCursor,
	parseCursorDirection
} from '$lib/server/cursorPagination';
import type { PageServerLoad } from './$types';

// Phase 36 follow-up: split out of the operational live auction page
// (current lot + bid form + queue) into its own tab — that page was
// getting too busy combining "run the auction" with "audit/correct past
// bids," the same reasoning that put Leading Bids on its own tab rather
// than folding it into Bookkeeping.
//
// null only in the defensive case where a live-phase bid's entry somehow
// has no live_lots row at all — shouldn't happen (an entry can only
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

// Cursor-paginated, sorted by placed_at, server-side player/bidder search —
// same shape Phase 35 established for Silent Auction Bids. See
// SilentBidFilters/the load function in auction/silent/+page.server.ts for
// the identical player-search two-step-lookup reasoning.
export const load: PageServerLoad = async ({ url, parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const filters = parseLiveBidFilters(url);
	const pageSize = parsePageSize(url.searchParams.get('page_size'));
	const direction = parseCursorDirection(url.searchParams.get('dir'));
	const cursor = decodeCursor(url.searchParams.get('cursor'));
	const ascending = direction === 'after';

	let bidsQuery = supabase
		.from('bids')
		.select(
			`id, amount, placed_at, voided_at, void_reason, bidder_name, placed_by_admin_id, entry_id,
			player_entries!bids_entry_id_fkey!inner(tournament_id, division, players(slug, first_name, last_name))`
		)
		.eq('player_entries.tournament_id', tournament.id)
		.eq('phase', 'live')
		.order('placed_at', { ascending })
		.order('id', { ascending })
		.limit(pageSize + 1);

	if (cursor) {
		bidsQuery = bidsQuery.or(cursorFilterExpression(cursor, direction, 'placed_at'));
	}
	if (filters.bidder) {
		bidsQuery = bidsQuery.ilike('bidder_name', `%${filters.bidder}%`);
	}
	if (filters.player) {
		const { data: matchingPlayers, error: playersError } = await supabase
			.from('players')
			.select('id')
			.eq('tournament_id', tournament.id)
			.or(`first_name.ilike.%${filters.player}%,last_name.ilike.%${filters.player}%`);
		if (playersError) {
			error(500, playersError.message);
		}
		const ids = (matchingPlayers ?? []).map((p) => p.id);
		bidsQuery = bidsQuery.in(
			'player_entries.player_id',
			ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']
		);
	}

	const { data: bids, error: bidsError } = await bidsQuery;
	if (bidsError) {
		error(500, bidsError.message);
	}

	const { rows, hasNext, hasPrev } = buildCursorPage(
		bids ?? [],
		direction,
		cursor !== null,
		pageSize
	);

	// Lot state per bid — see void-bid/index.ts's own header comment for why
	// this distinction matters: a bid on a still-open (or not-yet-opened)
	// lot needs no special handling when voided (place-bid/close_live_lot's
	// own high-bid lookups already exclude voided bids), but voiding a
	// *closed* lot's winning bid recomputes the winner immediately. One
	// live_lots row per entry ever (see live_lots' own migration comment),
	// so a plain Map is safe here.
	const entryIds = rows.map((bid) => bid.entry_id);
	const { data: bidLots, error: bidLotsError } =
		entryIds.length > 0
			? await supabase
					.from('live_lots')
					.select('entry_id, opened_at, closed_at')
					.in('entry_id', entryIds)
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

	const bidRows: LiveAuctionBidRow[] = rows.flatMap((bid) =>
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
		bids: bidRows,
		filters,
		pageSize,
		hasNext,
		hasPrev,
		nextCursor:
			hasNext && rows.length > 0
				? encodeCursor({
						sortValue: rows[rows.length - 1].placed_at,
						id: rows[rows.length - 1].id
					})
				: null,
		prevCursor:
			hasPrev && rows.length > 0
				? encodeCursor({ sortValue: rows[0].placed_at, id: rows[0].id })
				: null,
		title: `${tournament.name} · Live auction bids · EMGC Bet`,
		description: `Review and void live-auction bids for ${tournament.name}.`
	};
};
