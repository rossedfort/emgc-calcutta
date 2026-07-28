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
>;

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
			'id, slug, first_name, last_name, preferences, photo_url, flight, handicap_index, user_id'
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
		.select('id, division, status')
		.eq('player_id', player.id)
		.order('division');
	if (entriesError) {
		error(500, entriesError.message);
	}

	const entryIds = (playerEntries ?? []).map((entry) => entry.id);

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
		bids: bidsByEntryId.get(entry.id) ?? []
	}));

	return {
		tournament,
		player: player as PlayerProfile,
		linkedUserName,
		entries,
		isYou: player.user_id === session.user.id,
		title: `${formatPlayerName(player)} · ${tournament.name} · EMGC Bet`,
		description: `Player profile and bidding status for ${formatPlayerName(player)} in ${tournament.name}.`
	};
};
