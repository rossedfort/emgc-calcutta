import { get, writable, type Readable } from 'svelte/store';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	Database,
	RealtimeBid,
	RealtimeLiveLot,
	RealtimePlayer
} from '@emgc-calcutta/shared-types';

export interface TournamentRealtime {
	bids: Readable<RealtimeBid[]>;
	players: Readable<RealtimePlayer[]>;
	liveLots: Readable<RealtimeLiveLot[]>;
	/** Unsubscribes and tears down the channel — call on component unmount. */
	destroy: () => void;
}

// One Realtime channel per tournament (spec 4.5): broadcasts new bids,
// player status changes (reserved, later sold/etc.), and live_lots changes
// (a lot opening/closing, its anti-snipe countdown resetting) to every
// connected client. Realtime delivery alone isn't reliable across a dropped
// connection, so this reconciles with a fresh query every time the channel
// (re)subscribes — the initial connect and any reconnect after a network
// hiccup land on the exact same code path (the subscribe callback), rather
// than a separately-written reconnect handler that could drift out of sync
// with it.
export function createTournamentRealtime(
	supabase: SupabaseClient<Database>,
	tournamentId: string
): TournamentRealtime {
	const bids = writable<RealtimeBid[]>([]);
	const players = writable<RealtimePlayer[]>([]);
	const liveLots = writable<RealtimeLiveLot[]>([]);

	async function reconcile() {
		const { data: playerRows } = await supabase
			.from('players')
			.select('id, status')
			.eq('tournament_id', tournamentId);
		players.set(playerRows ?? []);

		const { data: liveLotRows } = await supabase
			.from('live_lots')
			.select('id, player_id, queue_position, opened_at, closed_at, closes_at, winning_bid_id')
			.eq('tournament_id', tournamentId);
		liveLots.set(liveLotRows ?? []);

		const playerIds = (playerRows ?? []).map((p) => p.id);
		if (playerIds.length === 0) {
			bids.set([]);
			return;
		}

		const { data: bidRows } = await supabase
			.from('bids')
			.select('id, player_id, bidder_id, amount, phase, placed_at, voided_at')
			.in('player_id', playerIds)
			.order('placed_at', { ascending: true });
		bids.set(bidRows ?? []);
	}

	const channel = supabase
		.channel(`tournament:${tournamentId}`)
		.on(
			'postgres_changes',
			{
				event: 'UPDATE',
				schema: 'public',
				table: 'players',
				filter: `tournament_id=eq.${tournamentId}`
			},
			(payload) => {
				const updated = payload.new as RealtimePlayer;
				players.update((current) =>
					current.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
				);
			}
		)
		.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids' }, (payload) => {
			const newBid = payload.new as RealtimeBid;
			// `bids` has no tournament_id column to filter on server-side (see
			// spec 5's data model — a Bid is scoped by playerId, not directly
			// by tournament), so this table-wide subscription checks
			// membership client-side against the already-reconciled player
			// list. Cheap at this app's scale (a single internal league).
			if (get(players).some((p) => p.id === newBid.player_id)) {
				bids.update((current) => [...current, newBid]);
			}
		})
		.on(
			'postgres_changes',
			{
				event: 'INSERT',
				schema: 'public',
				table: 'live_lots',
				filter: `tournament_id=eq.${tournamentId}`
			},
			(payload) => {
				liveLots.update((current) => [...current, payload.new as RealtimeLiveLot]);
			}
		)
		.on(
			'postgres_changes',
			{
				event: 'UPDATE',
				schema: 'public',
				table: 'live_lots',
				filter: `tournament_id=eq.${tournamentId}`
			},
			(payload) => {
				const updated = payload.new as RealtimeLiveLot;
				liveLots.update((current) =>
					current.map((lot) => (lot.id === updated.id ? { ...lot, ...updated } : lot))
				);
			}
		)
		.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				reconcile();
			}
		});

	return {
		bids,
		players,
		liveLots,
		destroy: () => {
			supabase.removeChannel(channel);
		}
	};
}
