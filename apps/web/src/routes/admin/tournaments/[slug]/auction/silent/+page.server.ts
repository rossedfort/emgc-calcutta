import { error } from '@sveltejs/kit';
import type { Enums } from '@emgc-calcutta/shared-types';
import type { PageServerLoad } from './$types';

export interface SilentAuctionBidRow {
	id: string;
	amount: number;
	placed_at: string;
	voided_at: string | null;
	void_reason: string | null;
	bidder_name: string | null;
	placed_by_admin_id: string | null;
	division: string;
	player: { slug: string; first_name: string; last_name: string };
}

// Phase 32: for the admin-on-behalf-of-participant bid panel embedded at
// the top of this page — every currently-open entry (the type-ahead
// search target, since many are open at once during the silent phase,
// unlike live's single auto-targeted lot) and every participant with a
// roster entry in this tournament (anyone else would just fail
// place-bid's own roster-membership check).
export interface SilentBidEntry {
	id: string;
	first_name: string;
	last_name: string;
	flight: string;
	division: string;
	status: Enums<'player_status'>;
}

export interface AdminBidParticipant {
	id: string;
	name: string;
	email: string;
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
			`id, amount, placed_at, voided_at, void_reason, bidder_name, placed_by_admin_id,
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
						placed_by_admin_id: bid.placed_by_admin_id,
						division: bid.player_entries.division,
						player: bid.player_entries.players
					}
				]
			: []
	);

	const { data: entryRows, error: entriesError } = await supabase
		.from('player_entries')
		.select('id, division, status, players(first_name, last_name, flight)')
		.eq('tournament_id', tournament.id);
	if (entriesError) {
		error(500, entriesError.message);
	}

	const entries: SilentBidEntry[] = (entryRows ?? []).flatMap((entry) =>
		entry.players
			? [
					{
						id: entry.id,
						first_name: entry.players.first_name,
						last_name: entry.players.last_name,
						flight: entry.players.flight,
						division: entry.division,
						status: entry.status
					}
				]
			: []
	);

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

	return {
		bids: rows,
		entries,
		participants,
		title: `${tournament.name} · Silent auction bids · EMGC Bet`,
		description: `Review and void silent-auction bids for ${tournament.name}.`
	};
};
