<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type {
		RealtimeBid,
		RealtimeLiveLot,
		RealtimePlayerEntry
	} from '@emgc-calcutta/shared-types';
	import '../../../../../../../../app.css';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';
	import LastBidTimestamp from '$lib/components/LastBidTimestamp.svelte';
	import LiveClock from '$lib/components/LiveClock.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import LiveAuctionTVBoard from './LiveAuctionTVBoard.svelte';

	// `@` (bare, no name) resets this page's rendered layout all the way to
	// the true root +layout.svelte, skipping every ancestor .svelte between
	// there and here — (app)'s AppShell, admin's plain wrapper, the
	// tournament's PageHeader/tab nav, and the auction sub-nav. This is what
	// actually makes the page shell-less (see admin/tournaments/[slug]/
	// auction/live/+page.svelte's "TV Display" button). This reset also
	// skips the ancestor *load* chain, not just the component tree —
	// admin/+layout.server.ts's role check and admin/tournaments/[slug]/
	// +layout.server.ts's tournament fetch do NOT run for this route despite
	// living in that part of the tree (confirmed via this route's own
	// generated $types.d.ts, see +page.server.ts's header comment), so both
	// are reimplemented directly in +page.server.ts rather than relied on
	// from ancestors. Because the reset goes past (app)'s +layout.svelte,
	// app.css (normally loaded there) has to be imported directly here too.
	let { data } = $props();

	let liveBids = $state<RealtimeBid[]>([]);
	let liveEntries = $state<RealtimePlayerEntry[]>([]);
	let liveLots = $state<RealtimeLiveLot[]>([]);
	let connectionStatus = $state<RealtimeConnectionStatus>('connecting');
	let bidsReady = $state(false);
	let now = $state(new Date());

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
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => {
			unsubBids();
			unsubEntries();
			unsubLots();
			unsubConnection();
			unsubReady();
			rt.destroy();
			clearInterval(tick);
		};
	});

	let players = $derived(
		data.players.map((player) => {
			const live = liveEntries.find((e) => e.id === player.id);
			return live ? { ...player, status: live.status as typeof player.status } : player;
		})
	);

	let mostRecentBidPlacedAt = $derived.by(() => {
		const relevant = liveBids.filter((bid) => bid.phase === 'live' && !bid.voided_at);
		if (relevant.length === 0) return null;
		return relevant.reduce((latest, bid) =>
			new Date(bid.placed_at).getTime() > new Date(latest.placed_at).getTime() ? bid : latest
		).placed_at;
	});
</script>

<svelte:head>
	<title>{page.data.title}</title>
	<meta name="description" content={page.data.description} />
</svelte:head>

<div class="min-h-screen bg-fairway/5">
	<div class="mx-auto flex max-w-7xl items-center justify-between gap-4 px-8 pt-4">
		<LiveClock {now} />
		<RealtimeStatusBanner status={connectionStatus} />
		<LastBidTimestamp placedAt={mostRecentBidPlacedAt} />
	</div>
	<LiveAuctionTVBoard
		tournament={data.tournament}
		{players}
		{liveBids}
		{bidsReady}
		{liveLots}
		currentUserId={data.currentUserId}
		{now}
	/>
</div>
