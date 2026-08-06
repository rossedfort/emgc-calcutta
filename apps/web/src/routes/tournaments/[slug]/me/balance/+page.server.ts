import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface OwedRow {
	id: string;
	first_name: string;
	last_name: string;
	division: string;
	status: 'sold_silent' | 'sold_live';
	buyer_marked_paid_at: string | null;
	winning_bid: { amount: number } | null;
	// A pending stake buy-back request against this entry (Phase 14) —
	// null if none exists, or if one exists but was already responded to
	// (accepted/rejected requests aren't actionable, so they're not
	// surfaced here; the golfer's own "Your stake" section is where an
	// already-responded request's outcome shows).
	pending_buyback: {
		id: string;
		percentage: number;
		amount: number;
		requester: { first_name: string | null; last_name: string | null } | null;
	} | null;
}

export interface WonRow {
	id: string;
	placement: number;
	amount: number;
	marked_paid_at: string | null;
	player: { first_name: string; last_name: string; division: string } | null;
}

export interface StakeRow {
	id: string;
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

// Phase 19: scoped to one tournament (resolved by slug) rather than
// aggregating across every tournament the user has ever played in — see
// this phase's backlog entry for why. Spec 4.8/6.9: "Self" access — any
// authenticated user, not just Participants, since self-bidding (spec 4.9)
// means an Admin or Owner can just as easily owe money into the pot or
// have won a payout.
//
// "What you owe": every entry in this tournament this user's winning bid
// bought — winning_bid:bids!player_entries_winning_bid_id_fkey!inner makes
// the embed an inner join so .eq('winning_bid.bidder_id', ...) can filter
// on it; RLS alone isn't enough to scope this to "mine" for an Admin/Owner
// caller, since bids_select_participant_plus deliberately lets Admin/Owner
// read every bid (needed for the live auction UI), not just their own.
//
// "What you've won": every Payout in this tournament where this user is
// the winning bidder. Scoping this to "mine" for an Admin/Owner caller does
// NOT happen automatically from RLS alone here either — same reasoning as
// above, payouts_select_self_or_admin_owner's "or admin/owner" branch
// grants read access to *every* payout, not just this user's, so the
// explicit bidder_id filter is still required for correctness, not just
// defense-in-depth.
export const load: PageServerLoad = async ({ locals: { supabase }, parent }) => {
	const { tournament, currentUserId: userId } = await parent();

	const { data: owedEntries, error: owedError } = await supabase
		.from('player_entries')
		.select(
			`id, division, status, buyer_marked_paid_at, players(first_name, last_name),
			winning_bid:bids!player_entries_winning_bid_id_fkey!inner(amount, bidder_id),
			stake_buyback:stake_buybacks(id, status, percentage, amount, requester:users!stake_buybacks_requester_id_fkey(first_name, last_name))`
		)
		.eq('tournament_id', tournament.id)
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
							winning_bid: entry.winning_bid,
							// stake_buyback comes back as an array for the same
							// reason "Your stake"'s own embed does (see that
							// section's comment below) — unique(entry_id) is a
							// plain `create unique index`, not an inline `unique`
							// modifier, so the type generator doesn't infer
							// one-to-one.
							pending_buyback:
								entry.stake_buyback[0]?.status === 'pending' ? entry.stake_buyback[0] : null
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
			'id, placement, amount, marked_paid_at, entry:player_entries(division, players(first_name, last_name))'
		)
		.eq('tournament_id', tournament.id)
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
	// section above already covers the buyer's side. players!inner is
	// required, not just style, the same reason winning_bid's !inner is
	// above: PostgREST only allows a top-level .eq() against an embedded
	// resource's own column when that embed is an inner join. Skipped
	// entirely (no query at all) when this tournament never configured
	// buy_back_percentage — nothing could possibly show here.
	const stake: StakeRow[] = [];
	if (tournament.buy_back_percentage !== null) {
		const { data: stakeEntries, error: stakeError } = await supabase
			.from('player_entries')
			.select(
				`id, division,
				players!inner(first_name, last_name, user_id),
				winning_bid:bids!player_entries_winning_bid_id_fkey!inner(amount, bidder_id, buyer:users(first_name, last_name, email, phone)),
				stake_buyback:stake_buybacks(status)`
			)
			.eq('tournament_id', tournament.id)
			.eq('players.user_id', userId)
			.in('status', ['sold_silent', 'sold_live']);
		if (stakeError) {
			error(500, stakeError.message);
		}

		const buyBackPercentage = tournament.buy_back_percentage;
		const eventStarted = tournament.event_start_at
			? new Date(tournament.event_start_at).getTime() <= Date.now()
			: false;
		for (const entry of stakeEntries ?? []) {
			if (!entry.players || !entry.winning_bid) continue;
			const isSelfBought = entry.winning_bid.bidder_id === userId;
			// entry_id is unique on stake_buybacks (a real DB constraint,
			// verified in the Phase 14 task 1 migration), but it's a plain
			// `create unique index`, not an inline `unique` column modifier —
			// `supabase gen types typescript` only infers a reverse embed as
			// one-to-one from the latter, so this still comes back typed as
			// an array even though it's at most one row.
			const stakeBuybackStatus = (entry.stake_buyback[0]?.status ?? null) as
				'pending' | 'accepted' | 'rejected' | null;
			stake.push({
				id: entry.id,
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
			});
		}
	}

	return {
		owed,
		won,
		stake,
		title: `My balance · ${tournament.name} · EMGC Bet`,
		description: `What you owe and what you've won in ${tournament.name}.`
	};
};
