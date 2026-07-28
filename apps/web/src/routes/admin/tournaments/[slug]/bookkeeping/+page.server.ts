import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface BookkeepingRow {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	division: string;
	status: 'sold_silent' | 'sold_live';
	buyer_marked_paid_at: string | null;
	winning_bid: {
		amount: number;
		bidder: {
			id: string;
			first_name: string | null;
			last_name: string | null;
			email: string;
		} | null;
	} | null;
}

export interface PayoutRow {
	id: string;
	placement: number;
	pot_share: number;
	amount: number;
	marked_paid_at: string | null;
	player: { first_name: string; last_name: string; division: string } | null;
	bidder: { id: string; first_name: string | null; last_name: string | null; email: string } | null;
}

// Only sold entries have a winning bid to mark paid — open/reserved/no_bid
// entries never appear here, unlike the general players roster page.
// winning_bid:bids!player_entries_winning_bid_id_fkey disambiguates the
// embed the same way void-bid's server-side query does: player_entries<->
// bids now has two FK paths (bids.entry_id and
// player_entries.winning_bid_id), so PostgREST can't infer which one this
// embed means without the hint.
//
// payouts rows won't exist yet until the set-placement task (Phase 7,
// later) is built — this section renders empty until then, same as any
// other tournament before results are entered.
//
// bidder:users!payouts_bidder_id_fkey needs the same disambiguation
// hint, for a different reason than the player_entries<->bids embed
// above: payouts has two FK paths to users (bidder_id and
// marked_paid_by), not a bidirectional pair between the same two tables
// like player_entries<->bids — but the effect on PostgREST's embed
// inference is the same "more than one relationship was found" failure.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, buyer_marked_paid_at, players(slug, first_name, last_name), winning_bid:bids!player_entries_winning_bid_id_fkey(amount, bidder:users(id, first_name, last_name, email))'
		)
		.eq('tournament_id', tournament.id)
		.in('status', ['sold_silent', 'sold_live']);
	if (entriesError) {
		error(500, entriesError.message);
	}

	// Sorted client-side, not via .order() — the query root is now
	// player_entries (Phase 11), so first_name/last_name live on the
	// embedded `players` resource rather than the queried table itself.
	const players: BookkeepingRow[] = (entries ?? [])
		.flatMap((entry) =>
			entry.players
				? [
						{
							id: entry.id,
							slug: entry.players.slug,
							first_name: entry.players.first_name,
							last_name: entry.players.last_name,
							division: entry.division,
							status: entry.status as 'sold_silent' | 'sold_live',
							buyer_marked_paid_at: entry.buyer_marked_paid_at,
							winning_bid: entry.winning_bid
						}
					]
				: []
		)
		.sort(
			(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
		);

	// player_entries(division, players(first_name, last_name)) — payouts.
	// entry_id has a single FK path to player_entries (no disambiguation
	// hint needed there), but division lives on player_entries while
	// first_name/last_name live on players, so this embed nests one level
	// deeper than the pre-split query did.
	const { data: payoutRows, error: payoutsError } = await supabase
		.from('payouts')
		.select(
			'id, placement, pot_share, amount, marked_paid_at, entry:player_entries(division, players(first_name, last_name)), bidder:users!payouts_bidder_id_fkey(id, first_name, last_name, email)'
		)
		.eq('tournament_id', tournament.id)
		.order('placement');
	if (payoutsError) {
		error(500, payoutsError.message);
	}

	const payouts: PayoutRow[] = (payoutRows ?? []).map((payout) => ({
		id: payout.id,
		placement: payout.placement,
		pot_share: payout.pot_share,
		amount: payout.amount,
		marked_paid_at: payout.marked_paid_at,
		player: payout.entry?.players
			? {
					first_name: payout.entry.players.first_name,
					last_name: payout.entry.players.last_name,
					division: payout.entry.division
				}
			: null,
		bidder: payout.bidder
	}));

	return {
		players,
		payouts,
		title: `${tournament.name} · Bookkeeping · EMGC Bet`,
		description: `Track paid and unpaid winning bids and payouts for ${tournament.name}.`
	};
};
