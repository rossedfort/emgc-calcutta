import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// One row per player_entries row that currently has a standing (non-voided)
// bid but hasn't sold yet — status 'open' or 'reserved', covering both the
// many-simultaneously-open entries of the silent auction and whichever
// entry is the live auction's currently-open lot (open_live_lot leaves
// player_entries.status at 'reserved' and only flips it to sold_live/no_bid
// on close, per close_live_lot). Phase comes from the leading bid itself
// (bids.phase), not the entry's status, so a 'reserved' entry still queued
// for live but showing its original silent-phase bid reads as "Silent"
// rather than misleadingly "Live".
export interface LeadingBidRow {
	id: string;
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	handicap_index: number | null;
	status: 'open' | 'reserved';
	isField: boolean;
	amount: number;
	phase: 'silent' | 'live';
	bidder: {
		id: string;
		first_name: string | null;
		last_name: string | null;
		email: string;
	} | null;
}

// Admin-only review screen, deliberately not realtime — a plain page-load
// snapshot refreshed via invalidateAll(), same precedent as the silent
// auction admin page's own "Recent silent auction bids" table (which
// documents the same reasoning: this is a screen an Admin opens to check
// in on, not one left up and watched continuously like a TV display).
//
// bidder:users!bids_bidder_id_fkey disambiguates the embed the same way
// every other bids->users query in this codebase does (Phase 32 added a
// second FK path via placed_by_admin_id).
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { tournament } = await parent();

	const { data: entries, error: entriesError } = await supabase
		.from('player_entries')
		.select(
			'id, flight, division, status, players(slug, first_name, last_name, handicap_index, is_field)'
		)
		.eq('tournament_id', tournament.id)
		.in('status', ['open', 'reserved']);
	if (entriesError) {
		error(500, entriesError.message);
	}

	const entryIds = (entries ?? []).map((entry) => entry.id);

	const { data: bids, error: bidsError } =
		entryIds.length > 0
			? await supabase
					.from('bids')
					.select(
						'entry_id, amount, phase, bidder:users!bids_bidder_id_fkey(id, first_name, last_name, email)'
					)
					.in('entry_id', entryIds)
					.is('voided_at', null)
			: { data: [], error: null };
	if (bidsError) {
		error(500, bidsError.message);
	}

	// Highest non-voided bid per entry — same "current high bid" definition
	// as $lib/bids.ts's currentHighBid, just reduced server-side over a
	// plain query result instead of a Realtime feed.
	const leadingBidByEntryId = new Map<string, (typeof bids)[number]>();
	for (const bid of bids ?? []) {
		const current = leadingBidByEntryId.get(bid.entry_id);
		if (!current || bid.amount > current.amount) {
			leadingBidByEntryId.set(bid.entry_id, bid);
		}
	}

	const rows: LeadingBidRow[] = (entries ?? []).flatMap((entry) => {
		const leadingBid = leadingBidByEntryId.get(entry.id);
		// An 'open' entry with no bid at all yet has nothing to show here —
		// it'll appear once (if) it receives its first bid.
		if (!entry.players || !leadingBid) return [];
		return [
			{
				id: entry.id,
				slug: entry.players.slug,
				first_name: entry.players.first_name,
				last_name: entry.players.last_name,
				flight: entry.flight,
				division: entry.division,
				handicap_index: entry.players.handicap_index,
				status: entry.status as 'open' | 'reserved',
				isField: entry.players.is_field,
				amount: leadingBid.amount,
				phase: leadingBid.phase,
				bidder: leadingBid.bidder
			}
		];
	});

	return {
		leadingBids: rows,
		title: `${tournament.name} · Leading bids · EMGC Bet`,
		description: `Current standing bids not yet finalized for ${tournament.name}.`
	};
};
