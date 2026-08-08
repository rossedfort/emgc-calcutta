import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface SilentAuctionBidRow {
	id: string;
	amount: number;
	placed_at: string;
	voided_at: string | null;
	void_reason: string | null;
	bidder_name: string | null;
	division: string;
	player: { slug: string; first_name: string; last_name: string };
}

// Admin review/void surface for the silent auction's bids — a plain
// page-load snapshot (refreshed via invalidateAll() after a void), not
// realtime-driven like auction/live: this is a review table an Admin opens
// to audit and correct bids, not an operational screen someone watches
// live. Scoped to phase = 'silent' since auction/live is the existing,
// separate screen for live-phase lots.
//
// player_entries!bids_entry_id_fkey!inner disambiguates the embed (bids
// and player_entries now have two FK paths between them — the other being
// player_entries.winning_bid_id -> bids.id, same ambiguity void-bid's own
// server-side query has to resolve) and turns it into an inner join so
// .eq('player_entries.tournament_id', ...) can actually scope the root
// `bids` rows to this tournament rather than being ignored.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: bids, error: bidsError } = await supabase
		.from('bids')
		.select(
			`id, amount, placed_at, voided_at, void_reason, bidder_name,
			player_entries!bids_entry_id_fkey!inner(tournament_id, division, players(slug, first_name, last_name))`
		)
		.eq('player_entries.tournament_id', tournament.id)
		.eq('phase', 'silent')
		.order('placed_at', { ascending: false })
		.limit(100);
	if (bidsError) {
		error(500, bidsError.message);
	}

	const rows: SilentAuctionBidRow[] = (bids ?? []).flatMap((bid) =>
		bid.player_entries?.players
			? [
					{
						id: bid.id,
						amount: bid.amount,
						placed_at: bid.placed_at,
						voided_at: bid.voided_at,
						void_reason: bid.void_reason,
						bidder_name: bid.bidder_name,
						division: bid.player_entries.division,
						player: bid.player_entries.players
					}
				]
			: []
	);

	return {
		bids: rows,
		title: `${tournament.name} · Silent auction bids · EMGC Bet`,
		description: `Review and void silent-auction bids for ${tournament.name}.`
	};
};
