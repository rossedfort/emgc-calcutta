import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface OwedRow {
	id: string;
	first_name: string;
	last_name: string;
	division: string;
	status: 'sold_silent' | 'sold_live';
	buyer_marked_paid_at: string | null;
	tournament: { name: string } | null;
	winning_bid: { amount: number } | null;
}

export interface WonRow {
	id: string;
	placement: number;
	amount: number;
	marked_paid_at: string | null;
	tournament: { name: string } | null;
	player: { first_name: string; last_name: string; division: string } | null;
}

export interface StakeRow {
	id: string;
	tournament_name: string;
	first_name: string;
	last_name: string;
	division: string;
	amount: number;
	buy_back_percentage: number;
	buy_back_amount: number;
	buyer: {
		first_name: string | null;
		last_name: string | null;
		email: string;
		phone: string | null;
	} | null;
	// Whether the "Buy back stake" button should actually be offered —
	// computed here, not left to the page, so the eligibility rules
	// (Phase 14 task 2: not self-bought, before the tournament's
	// event_start_at, no already-pending/accepted request) live in exactly
	// one place rather than being re-derived client-side too.
	can_request: boolean;
	stake_buyback_status: 'pending' | 'accepted' | 'rejected' | null;
}

// Spec 4.8/6.9: "Self" access — any authenticated user, not just
// Participants, since self-bidding (spec 4.9) means an Admin or Owner
// can just as easily owe money into the pot or have won a payout.
//
// "What you owe": every entry this user's winning bid bought, across
// every tournament — winning_bid:bids!player_entries_winning_bid_id_fkey!inner
// makes the embed an inner join so .eq('winning_bid.bidder_id', ...) can
// filter on it; RLS alone isn't enough to scope this to "mine" for an
// Admin/Owner caller, since bids_select_participant_plus deliberately
// lets Admin/Owner read every bid (needed for the live auction UI), not
// just their own.
//
// "What you've won": every Payout where this user is the winning
// bidder. Scoping this to "mine" for an Admin/Owner caller does NOT
// happen automatically from RLS alone here either — same reasoning as
// above, payouts_select_self_or_admin_owner's "or admin/owner" branch
// grants read access to *every* payout, not just this user's, so the
// explicit bidder_id filter is still required for correctness, not just
// defense-in-depth.
export const load: PageServerLoad = async ({ locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}
	const userId = session.user.id;

	const { data: owedEntries, error: owedError } = await supabase
		.from('player_entries')
		.select(
			'id, division, status, buyer_marked_paid_at, tournament:tournaments(name), players(first_name, last_name), winning_bid:bids!player_entries_winning_bid_id_fkey!inner(amount, bidder_id)'
		)
		.eq('winning_bid.bidder_id', userId);
	if (owedError) {
		error(500, owedError.message);
	}

	// Sorted client-side, not via .order() — the query root is now
	// player_entries (Phase 11), so first_name/last_name live on the
	// embedded `players` resource rather than the queried table itself.
	const owed: OwedRow[] = (owedEntries ?? [])
		.flatMap((entry) =>
			entry.players
				? [
						{
							id: entry.id,
							first_name: entry.players.first_name,
							last_name: entry.players.last_name,
							division: entry.division,
							status: entry.status as 'sold_silent' | 'sold_live',
							buyer_marked_paid_at: entry.buyer_marked_paid_at,
							tournament: entry.tournament,
							winning_bid: entry.winning_bid
						}
					]
				: []
		)
		.sort(
			(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
		);

	// entry:player_entries(division, players(first_name, last_name)) —
	// payouts.entry_id has a single FK path to player_entries (no
	// disambiguation hint needed there), but division lives on
	// player_entries while first_name/last_name live on players, so this
	// embed nests one level deeper than the pre-split query did.
	const { data: wonRows, error: wonError } = await supabase
		.from('payouts')
		.select(
			'id, placement, amount, marked_paid_at, tournament:tournaments(name), entry:player_entries(division, players(first_name, last_name))'
		)
		.eq('bidder_id', userId)
		.order('placement');
	if (wonError) {
		error(500, wonError.message);
	}

	const won: WonRow[] = (wonRows ?? []).map((payout) => ({
		id: payout.id,
		placement: payout.placement,
		amount: payout.amount,
		marked_paid_at: payout.marked_paid_at,
		tournament: payout.tournament,
		player: payout.entry?.players
			? {
					first_name: payout.entry.players.first_name,
					last_name: payout.entry.players.last_name,
					division: payout.entry.division
				}
			: null
	}));

	// "Your stake" (Phase 14): entries where this user is the linked
	// golfer (players.user_id), not the buyer — the "What you owe"
	// section above already covers the buyer's side. players!inner and
	// tournaments!inner are required, not just style, the same reason
	// winning_bid's !inner is above: PostgREST only allows a top-level
	// .eq()/.not() against an embedded resource's own column when that
	// embed is an inner join. Scoped to tournaments with buy_back_percentage
	// actually configured — an entry sold in a tournament that never
	// turned this feature on has nothing to show here.
	const { data: stakeEntries, error: stakeError } = await supabase
		.from('player_entries')
		.select(
			`id, division,
			players!inner(first_name, last_name, user_id),
			tournament:tournaments!inner(id, name, buy_back_percentage, event_start_at),
			winning_bid:bids!player_entries_winning_bid_id_fkey!inner(amount, bidder_id, buyer:users(first_name, last_name, email, phone)),
			stake_buyback:stake_buybacks(status)`
		)
		.eq('players.user_id', userId)
		.in('status', ['sold_silent', 'sold_live'])
		.not('tournament.buy_back_percentage', 'is', null);
	if (stakeError) {
		error(500, stakeError.message);
	}

	const now = Date.now();
	const stake: StakeRow[] = (stakeEntries ?? []).flatMap((entry) => {
		if (!entry.players || !entry.tournament || !entry.winning_bid) return [];
		const buyBackPercentage = entry.tournament.buy_back_percentage!;
		const isSelfBought = entry.winning_bid.bidder_id === userId;
		const eventStarted = entry.tournament.event_start_at
			? new Date(entry.tournament.event_start_at).getTime() <= now
			: false;
		// entry_id is unique on stake_buybacks (a real DB constraint,
		// verified in the Phase 14 task 1 migration), but it's a plain
		// `create unique index`, not an inline `unique` column modifier —
		// `supabase gen types typescript` only infers a reverse embed as
		// one-to-one from the latter, so this still comes back typed as an
		// array even though it's at most one row.
		const stakeBuybackStatus = (entry.stake_buyback[0]?.status ?? null) as
			'pending' | 'accepted' | 'rejected' | null;
		return [
			{
				id: entry.id,
				tournament_name: entry.tournament.name,
				first_name: entry.players.first_name,
				last_name: entry.players.last_name,
				division: entry.division,
				amount: entry.winning_bid.amount,
				buy_back_percentage: buyBackPercentage,
				buy_back_amount: Math.round(entry.winning_bid.amount * buyBackPercentage * 100) / 100,
				buyer: entry.winning_bid.buyer,
				can_request:
					!isSelfBought &&
					!eventStarted &&
					stakeBuybackStatus !== 'pending' &&
					stakeBuybackStatus !== 'accepted',
				stake_buyback_status: stakeBuybackStatus
			}
		];
	});

	return {
		owed,
		won,
		stake,
		title: 'My balance · EMGC Bet',
		description: "What you owe and what you've won across every EMGC Bet tournament."
	};
};
