<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type {
		RealtimeBid,
		RealtimeLiveLot,
		RealtimePlayerEntry
	} from '@emgc-calcutta/shared-types';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';
	import { tournamentPhase } from '$lib/tournamentPhase';
	import LiveAuctionBoard from './LiveAuctionBoard.svelte';
	import SelfLinkModal from './SelfLinkModal.svelte';
	import SilentAuctionBoard from './SilentAuctionBoard.svelte';
	import TournamentRoster from './TournamentRoster.svelte';

	let { data } = $props();

	let liveBids = $state<RealtimeBid[]>([]);
	let liveEntries = $state<RealtimePlayerEntry[]>([]);
	let liveLots = $state<RealtimeLiveLot[]>([]);
	let connectionStatus = $state<RealtimeConnectionStatus>('connecting');
	let bidsReady = $state(false);

	// The root tournament layout owns the single ticking interval (see its
	// own comment) and shares it via context, rather than this page
	// keeping a second, redundant one-second timer computing the same
	// thing — reading `.now` off the same reactive object the layout
	// mutates keeps this derivation live.
	const clock = getContext<{ now: Date }>('tournament-clock');
	let now = $derived(clock.now);

	onMount(() => {
		const rt = createTournamentRealtime(
			data.supabase,
			data.tournament.id,
			data.players.map((p) => p.id)
		);
		const unsubBids = rt.bids.subscribe((bids) => (liveBids = bids));
		const unsubEntries = rt.entries.subscribe((entries) => (liveEntries = entries));
		const unsubLots = rt.liveLots.subscribe((lots) => (liveLots = lots));
		const unsubConnection = rt.connectionStatus.subscribe((s) => (connectionStatus = s));
		const unsubReady = rt.ready.subscribe((r) => (bidsReady = r));
		return () => {
			unsubBids();
			unsubEntries();
			unsubLots();
			unsubConnection();
			unsubReady();
			rt.destroy();
		};
	});

	// The Realtime store only carries id+status (see $lib/stores/realtime.ts)
	// — it's meant to overlay onto the fuller SSR snapshot, not replace it.
	let players = $derived(
		data.players.map((player) => {
			const live = liveEntries.find((e) => e.id === player.id);
			return live ? { ...player, status: live.status as typeof player.status } : player;
		})
	);

	let phase = $derived(tournamentPhase(data.tournament, now));

	let isLinkedToYou = $derived(players.some((p) => p.user_id === data.currentUserId));
</script>

<div class="flex flex-col gap-4">
	<RealtimeStatusBanner status={connectionStatus} />

	{#if !isLinkedToYou}
		<SelfLinkModal unlinkedPlayers={data.unlinkedPlayers} />
	{/if}

	{#if phase.phase === 'silent'}
		<SilentAuctionBoard
			tournament={data.tournament}
			{players}
			{liveBids}
			{bidsReady}
			currentUserId={data.currentUserId}
			supabase={data.supabase}
		/>
	{:else if phase.phase === 'live'}
		<LiveAuctionBoard
			tournament={data.tournament}
			{players}
			{liveBids}
			{bidsReady}
			{liveLots}
			currentUserId={data.currentUserId}
			supabase={data.supabase}
			{now}
		/>
	{:else}
		<TournamentRoster
			tournament={data.tournament}
			{players}
			{liveBids}
			currentUserId={data.currentUserId}
			{now}
		/>
	{/if}
</div>
