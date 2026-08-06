import { error, redirect } from '@sveltejs/kit';
import type { Enums } from '@emgc-calcutta/shared-types';
import { formatPlayerName, type Player } from '$lib/players';
import { formatUserName } from '$lib/profile';
import type { PageServerLoad } from './$types';

// Golfer identity only (Phase 11) — division/status moved to
// PlayerEntryProfile below, since a golfer can have one or two
// independently-statused sellable entries now.
export type PlayerProfile = Pick<
	Player,
	| 'id'
	| 'slug'
	| 'first_name'
	| 'last_name'
	| 'preferences'
	| 'photo_url'
	| 'flight'
	| 'handicap_index'
	| 'user_id'
	| 'is_field'
>;

// Phase 20 ("the field"): shown on a field lot's own profile page — every
// player pooled into it, since a bidder needs to know who they'd actually
// be buying before bidding on it, not just "The Field" as a name.
export interface PooledPlayer {
	slug: string;
	first_name: string;
	last_name: string;
	flight: string;
	handicap_index: number | null;
}

// Shown on a *swept* player's own profile instead — a link back to the
// field lot they were pooled into, so "In the field" isn't a dead end the
// way the old no_bid status was.
export interface FieldLotLink {
	slug: string;
	name: string;
}

export interface BidHistoryRow {
	id: string;
	amount: number;
	phase: 'silent' | 'live';
	placed_at: string;
	voided_at: string | null;
}

// One per player_entries row — a Championship golfer has two (Gross and
// Net), each rendered as its own section on this one profile page/URL,
// each with its own status and bid history.
export interface PlayerEntryProfile {
	id: string;
	division: string;
	status: Enums<'player_status'>;
	bids: BidHistoryRow[];
	// Set only for a swept (status = 'field') entry — where to send someone
	// reading "In the field" to find out who else is pooled with them and
	// who's bidding on it.
	fieldEntry: FieldLotLink | null;
}

export const load: PageServerLoad = async ({ params, locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	// RLS scopes both queries the same way as the list view: a tournament a
	// Participant can't see (a dry run) or a typo'd slug both resolve to a
	// 404, not a 403.
	const { data: tournament, error: tournamentError } = await supabase
		.from('tournaments')
		.select('id, slug, name')
		.eq('slug', params.slug)
		.maybeSingle();
	if (tournamentError) {
		error(500, tournamentError.message);
	}
	if (!tournament) {
		error(404, 'Tournament not found');
	}

	const { data: player, error: playerError } = await supabase
		.from('players')
		.select(
			'id, slug, first_name, last_name, preferences, photo_url, flight, handicap_index, user_id, is_field'
		)
		.eq('tournament_id', tournament.id)
		.eq('slug', params.playerSlug)
		.maybeSingle();
	if (playerError) {
		error(500, playerError.message);
	}
	if (!player) {
		error(404, 'Player not found');
	}

	// Only resolves to a name for the viewer themself or an Admin/Owner — RLS
	// on public.users blocks a Participant from reading another User's row,
	// so this naturally comes back null for "linked to someone else" without
	// needing to special-case that here. The profile still shows a generic
	// "linked to a participant" indicator in that case (see +page.svelte).
	let linkedUserName: string | null = null;
	if (player.user_id) {
		const { data } = await supabase
			.from('users')
			.select('first_name, last_name, email')
			.eq('id', player.user_id)
			.maybeSingle();
		linkedUserName = data ? (formatUserName(data) ?? data.email) : null;
	}

	const { data: playerEntries, error: entriesError } = await supabase
		.from('player_entries')
		.select('id, division, status, field_entry_id')
		.eq('player_id', player.id)
		.order('division');
	if (entriesError) {
		error(500, entriesError.message);
	}

	const entryIds = (playerEntries ?? []).map((entry) => entry.id);

	// Phase 20 ("the field"): two independent lookups, each only run when
	// actually needed, not embedded in the queries above — a self-
	// referencing player_entries embed (field_entry_id -> player_entries.id)
	// was confirmed directly against PostgREST (see set-placement) to only
	// ever resolve the reverse direction, so both directions here go through
	// their own explicit follow-up query instead.
	//
	// This is a field lot itself: every player pooled into it, so a bidder
	// can see who they'd actually be buying before bidding.
	let pooledPlayers: PooledPlayer[] = [];
	if (player.is_field && entryIds.length > 0) {
		const { data: pooledEntries, error: pooledError } = await supabase
			.from('player_entries')
			.select('players(slug, first_name, last_name, flight, handicap_index)')
			.in('field_entry_id', entryIds);
		if (pooledError) {
			error(500, pooledError.message);
		}
		pooledPlayers = (pooledEntries ?? [])
			.flatMap((entry) => (entry.players ? [entry.players] : []))
			.sort(
				(a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
			);
	}

	// This is a swept player: resolve each of their entries' own field lot
	// (name + slug) to link to, one lookup covering every entry at once.
	const fieldEntryIds = [
		...new Set(
			(playerEntries ?? [])
				.filter((entry) => entry.status === 'field' && entry.field_entry_id)
				.map((entry) => entry.field_entry_id as string)
		)
	];
	const fieldLotByEntryId = new Map<string, FieldLotLink>();
	if (fieldEntryIds.length > 0) {
		const { data: fieldLots, error: fieldLotsError } = await supabase
			.from('player_entries')
			.select('id, players(slug, first_name, last_name)')
			.in('id', fieldEntryIds);
		if (fieldLotsError) {
			error(500, fieldLotsError.message);
		}
		for (const lot of fieldLots ?? []) {
			if (lot.players) {
				fieldLotByEntryId.set(lot.id, {
					slug: lot.players.slug,
					name: formatPlayerName(lot.players)
				});
			}
		}
	}

	// Deliberately no bidder identity here (confirmed with the user) — the
	// same anonymity the silent/live auction boards already apply to other
	// participants applies to this history too, amount and timing only.
	const { data: bids, error: bidsError } =
		entryIds.length > 0
			? await supabase
					.from('bids')
					.select('id, entry_id, amount, phase, placed_at, voided_at')
					.in('entry_id', entryIds)
					.order('placed_at', { ascending: false })
			: { data: [] as ({ entry_id: string } & BidHistoryRow)[], error: null };
	if (bidsError) {
		error(500, bidsError.message);
	}

	const bidsByEntryId = new Map<string, BidHistoryRow[]>();
	for (const bid of bids ?? []) {
		const { entry_id, ...rest } = bid;
		const list = bidsByEntryId.get(entry_id) ?? [];
		list.push(rest);
		bidsByEntryId.set(entry_id, list);
	}

	const entries: PlayerEntryProfile[] = (playerEntries ?? []).map((entry) => ({
		id: entry.id,
		division: entry.division,
		status: entry.status,
		bids: bidsByEntryId.get(entry.id) ?? [],
		fieldEntry: entry.field_entry_id ? (fieldLotByEntryId.get(entry.field_entry_id) ?? null) : null
	}));

	return {
		tournament,
		player: player as PlayerProfile,
		linkedUserName,
		entries,
		pooledPlayers,
		isYou: player.user_id === session.user.id,
		title: `${formatPlayerName(player)} · ${tournament.name} · EMGC Bet`,
		description: `Player profile and bidding status for ${formatPlayerName(player)} in ${tournament.name}.`
	};
};
