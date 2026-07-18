import { get, writable, type Readable } from 'svelte/store';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	Database,
	RealtimeBid,
	RealtimeLiveLot,
	RealtimePlayer
} from '@emgc-calcutta/shared-types';

// 'connecting' is the initial state before the channel has ever joined
// (a normal part of first page load, not a problem worth surfacing).
// 'reconnecting' means a previously-established connection was lost —
// realtime-js's own channel rejoin logic (exponential backoff, driven by
// the underlying socket) retries automatically without any app code
// needing to call subscribe() again; this store exists purely so the UI
// can show that a retry is in progress instead of silently going stale.
export type RealtimeConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export interface TournamentRealtime {
	bids: Readable<RealtimeBid[]>;
	players: Readable<RealtimePlayer[]>;
	liveLots: Readable<RealtimeLiveLot[]>;
	connectionStatus: Readable<RealtimeConnectionStatus>;
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
	const connectionStatus = writable<RealtimeConnectionStatus>('connecting');

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
				connectionStatus.set('connected');
				// Runs on the initial join *and* every rejoin after a dropped
				// connection — both land on this same callback, so a reconnect
				// re-syncs from a fresh query rather than trusting whatever
				// events did or didn't arrive while disconnected.
				reconcile();
			} else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
				connectionStatus.set('reconnecting');
			}
		});

	return {
		bids,
		players,
		liveLots,
		connectionStatus,
		destroy: () => {
			supabase.removeChannel(channel);
		}
	};
}
