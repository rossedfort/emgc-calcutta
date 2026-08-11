import { get, writable, type Readable } from 'svelte/store';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	Database,
	RealtimeBid,
	RealtimeLiveLot,
	RealtimePlayerEntry
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
	// Renamed from `players` (Phase 11) — status now lives on player_entries,
	// not players, so this stream tracks entries, keyed by
	// player_entries.id, not players.id.
	entries: Readable<RealtimePlayerEntry[]>;
	liveLots: Readable<RealtimeLiveLot[]>;
	connectionStatus: Readable<RealtimeConnectionStatus>;
	/** True once the first reconcile() has resolved — lets callers show a
	 *  skeleton for bid-derived UI (current-high column, pot totals) instead
	 *  of a misleading "no bids yet" during the gap before real data lands. */
	ready: Readable<boolean>;
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
	tournamentId: string,
	// Entry ids already known from the page's own SSR load (player_entries.id
	// — see FieldPlayerRow), if the caller has them. Lets the very first bids
	// query fire in parallel with the entries query instead of waiting on it
	// just to learn ids the caller already had.
	knownEntryIds: string[] = []
): TournamentRealtime {
	const bids = writable<RealtimeBid[]>([]);
	const entries = writable<RealtimePlayerEntry[]>([]);
	const liveLots = writable<RealtimeLiveLot[]>([]);
	const connectionStatus = writable<RealtimeConnectionStatus>('connecting');
	const ready = writable(false);

	const entriesQuery = () =>
		supabase.from('player_entries').select('id, status').eq('tournament_id', tournamentId);
	const liveLotsQuery = () =>
		supabase
			.from('live_lots')
			.select('id, entry_id, queue_position, opened_at, closed_at, closes_at, winning_bid_id')
			.eq('tournament_id', tournamentId);
	const bidsQuery = (ids: string[]) =>
		ids.length > 0
			? supabase
					.from('bids')
					.select(
						'id, entry_id, bidder_id, amount, phase, placed_at, voided_at, bidder_name, placed_by_admin_id'
					)
					.in('entry_id', ids)
					.order('placed_at', { ascending: true })
			: Promise.resolve({ data: [] as RealtimeBid[] });

	async function reconcile() {
		if (knownEntryIds.length > 0) {
			// The caller already knows the entry ids (from its own SSR load),
			// so all three queries can run together — nothing here depends on
			// another query's result.
			const [{ data: entryRows }, { data: liveLotRows }, { data: bidRows }] = await Promise.all([
				entriesQuery(),
				liveLotsQuery(),
				bidsQuery(knownEntryIds)
			]);
			entries.set(entryRows ?? []);
			liveLots.set(liveLotRows ?? []);
			// Re-filter against this round's authoritative entry ids, not
			// knownEntryIds — a caller-supplied snapshot could in principle be
			// stale, and this keeps a bid for an id outside the real entry
			// list from ever slipping onto the board.
			const authoritativeEntryIds = new Set((entryRows ?? []).map((e) => e.id));
			bids.set((bidRows ?? []).filter((b) => authoritativeEntryIds.has(b.entry_id)));
		} else {
			// No caller-supplied ids (e.g. the "My Bids" page, or a reconnect
			// on a page that never had them) — the bids query has to wait for
			// *this call's own* entries query to learn which ids to filter by.
			// This must not read the `entries` store's current value instead:
			// reconcile() can run twice back-to-back (the immediate call below
			// plus the channel's own SUBSCRIBED-triggered call), and reading a
			// shared store from a second, possibly-concurrent call risks
			// seeing it still empty because the first call's own query simply
			// hasn't resolved yet — silently skipping the bids fetch on both
			// calls and leaving every pre-existing bid permanently missing
			// (reported directly: "My Bids" showing empty in production).
			const [{ data: entryRows }, { data: liveLotRows }] = await Promise.all([
				entriesQuery(),
				liveLotsQuery()
			]);
			entries.set(entryRows ?? []);
			liveLots.set(liveLotRows ?? []);
			const { data: bidRows } = await bidsQuery((entryRows ?? []).map((e) => e.id));
			bids.set(bidRows ?? []);
		}
		ready.set(true);
	}

	const channel = supabase
		.channel(`tournament:${tournamentId}`)
		.on(
			'postgres_changes',
			{
				event: 'UPDATE',
				schema: 'public',
				table: 'player_entries',
				filter: `tournament_id=eq.${tournamentId}`
			},
			(payload) => {
				const updated = payload.new as RealtimePlayerEntry;
				entries.update((current) =>
					current.map((e) => (e.id === updated.id ? { ...e, ...updated } : e))
				);
			}
		)
		.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids' }, (payload) => {
			const newBid = payload.new as RealtimeBid;
			// `bids` has no tournament_id column to filter on server-side (see
			// spec 5's data model — a Bid is scoped by entryId, not directly
			// by tournament), so this table-wide subscription checks
			// membership client-side against the already-reconciled entry
			// list. Cheap at this app's scale (a single internal league).
			if (get(entries).some((e) => e.id === newBid.entry_id)) {
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
				// Runs on every rejoin after a dropped connection — re-syncs from
				// a fresh query rather than trusting whatever events did or
				// didn't arrive while disconnected. (The very first reconcile is
				// fired below, independently of this callback — see its comment.)
				reconcile();
			} else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
				connectionStatus.set('reconnecting');
			}
		});

	// Fired immediately rather than waiting for the channel's WebSocket
	// handshake to reach SUBSCRIBED: that join round-trip has nothing to do
	// with these plain REST queries, and gating the first fetch behind it was
	// serializing two independent network operations that should overlap —
	// the visible "players render, bids pop in ~500ms later" delay this
	// fixes. subscribe()'s own SUBSCRIBED-triggered reconcile() above still
	// runs shortly after as normal; any bid placed in between is caught by
	// this second pass.
	reconcile();

	return {
		bids,
		entries,
		liveLots,
		connectionStatus,
		ready,
		destroy: () => {
			supabase.removeChannel(channel);
		}
	};
}
