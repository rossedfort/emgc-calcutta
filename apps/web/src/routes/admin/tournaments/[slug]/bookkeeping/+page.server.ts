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
	// Phase 20 ("the field"): flags "The Field" itself so the mark-paid
	// list reads as a pooled lot, not a regular competitor's name.
	isField: boolean;
}

export interface PayoutRow {
	id: string;
	amount: number;
	marked_paid_at: string | null;
	bidder: { id: string; first_name: string | null; last_name: string | null; email: string } | null;
	// Which side of an accepted stake buy-back (Phase 14) this row pays
	// out to — null for the ordinary (non-split) case, where `bidder` is
	// simply the entry's one winning bidder and there's nothing to
	// distinguish. 'buyer' is the winning bidder's remaining share,
	// 'golfer' is the golfer's bought-back share.
	role: 'buyer' | 'golfer' | null;
}

// One row per (entry, placement) — one or two payouts.PayoutRow entries
// grouped underneath, two only when an accepted stake buy-back split
// this entry's payout between the buyer and the golfer.
export interface PayoutGroup {
	entryId: string;
	placement: number;
	pot_share: number;
	totalAmount: number;
	player: { first_name: string; last_name: string; division: string } | null;
	rows: PayoutRow[];
	// Phase 20 ("the field"): set when this placement's own entry was a
	// swept (status = 'field') player — a link to the field lot they were
	// pooled into, since the payout above is credited to that lot's buyer,
	// not to a bid this player ever received individually.
	viaField: { slug: string; name: string } | null;
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
			'id, division, status, buyer_marked_paid_at, players(slug, first_name, last_name, is_field), winning_bid:bids!player_entries_winning_bid_id_fkey(amount, bidder:users(id, first_name, last_name, email))'
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
							winning_bid: entry.winning_bid,
							isField: entry.players.is_field
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
	// deeper than the pre-split query did. stake_buyback:stake_buybacks(...)
	// is null for an ordinary (non-split) payout — payouts.stake_buyback_id
	// itself is nullable, only set on the two rows an accepted buy-back
	// produced (Phase 14) — and has just the one FK path to stake_buybacks,
	// no disambiguation needed.
	const { data: payoutRows, error: payoutsError } = await supabase
		.from('payouts')
		.select(
			`id, entry_id, placement, pot_share, amount, marked_paid_at, bidder_id,
			entry:player_entries(division, status, field_entry_id, players(first_name, last_name)),
			bidder:users!payouts_bidder_id_fkey(id, first_name, last_name, email),
			stake_buyback:stake_buybacks(buyer_id, requester_id)`
		)
		.eq('tournament_id', tournament.id)
		.order('placement');
	if (payoutsError) {
		error(500, payoutsError.message);
	}

	// Phase 20 ("the field"): resolve each distinct field lot referenced by
	// a swept payout's own entry above — see the results pages' own load
	// functions for why this is a second query rather than a
	// self-referencing embed.
	const fieldEntryIds = [
		...new Set(
			(payoutRows ?? [])
				.filter((p) => p.entry?.status === 'field' && p.entry.field_entry_id)
				.map((p) => p.entry!.field_entry_id as string)
		)
	];
	const { data: fieldLots, error: fieldLotsError } =
		fieldEntryIds.length > 0
			? await supabase
					.from('player_entries')
					.select('id, players(slug, first_name, last_name)')
					.in('id', fieldEntryIds)
			: { data: [], error: null };
	if (fieldLotsError) {
		error(500, fieldLotsError.message);
	}
	const fieldLotByEntryId = new Map(
		(fieldLots ?? []).flatMap((lot) =>
			lot.players
				? [
						[
							lot.id,
							{ slug: lot.players.slug, name: `${lot.players.first_name} ${lot.players.last_name}` }
						] as const
					]
				: []
		)
	);

	// Grouped by entry_id — an accepted stake buy-back (Phase 14) produces
	// two payouts rows for the same entry/placement, and this page shows
	// them as one placement with two recipient sub-rows rather than two
	// seemingly-unrelated payouts. stake_buyback (unlike the reverse
	// embeds elsewhere in this app affected by the create-unique-index-vs-
	// inline-unique type-inference quirk) is a normal forward FK to
	// another table's primary key, so it's correctly inferred as a single
	// nullable object here, not an array.
	const groupsByEntryId = new Map<string, PayoutGroup>();
	for (const payout of payoutRows ?? []) {
		const buyback = payout.stake_buyback;
		const role: PayoutRow['role'] = !buyback
			? null
			: payout.bidder_id === buyback.buyer_id
				? 'buyer'
				: 'golfer';

		const row: PayoutRow = {
			id: payout.id,
			amount: payout.amount,
			marked_paid_at: payout.marked_paid_at,
			bidder: payout.bidder,
			role
		};

		const existing = groupsByEntryId.get(payout.entry_id);
		if (existing) {
			existing.rows.push(row);
			existing.totalAmount += payout.amount;
			continue;
		}
		groupsByEntryId.set(payout.entry_id, {
			entryId: payout.entry_id,
			placement: payout.placement,
			pot_share: payout.pot_share,
			totalAmount: payout.amount,
			player: payout.entry?.players
				? {
						first_name: payout.entry.players.first_name,
						last_name: payout.entry.players.last_name,
						division: payout.entry.division
					}
				: null,
			viaField:
				payout.entry?.status === 'field' && payout.entry.field_entry_id
					? (fieldLotByEntryId.get(payout.entry.field_entry_id) ?? null)
					: null,
			rows: [row]
		});
	}
	const payoutGroups = [...groupsByEntryId.values()].sort((a, b) => a.placement - b.placement);

	return {
		players,
		payoutGroups,
		title: `${tournament.name} · Bookkeeping · EMGC Bet`,
		description: `Track paid and unpaid winning bids and payouts for ${tournament.name}.`
	};
};
