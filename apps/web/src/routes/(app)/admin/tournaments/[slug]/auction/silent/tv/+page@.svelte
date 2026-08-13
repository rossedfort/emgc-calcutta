<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { RealtimeBid } from '@emgc-calcutta/shared-types';
	import '../../../../../../../../app.css';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';
	import LastBidTimestamp from '$lib/components/LastBidTimestamp.svelte';
	import LiveClock from '$lib/components/LiveClock.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import SilentAuctionTVBoard from './SilentAuctionTVBoard.svelte';

	// See admin/tournaments/[slug]/auction/live/tv/+page@.svelte for the full
	// explanation of the `@` reset (skips the app shell/admin chrome/tab nav,
	// and the ancestor *load* chain along with it — this route's own
	// +page.server.ts reimplements the auth check and tournament fetch
	// accordingly) and why app.css has to be imported directly here.
	let { data } = $props();

	let liveBids = $state<RealtimeBid[]>([]);
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
		const unsubConnection = rt.connectionStatus.subscribe((s) => (connectionStatus = s));
		const unsubReady = rt.ready.subscribe((r) => (bidsReady = r));
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => {
			unsubBids();
			unsubConnection();
			unsubReady();
			rt.destroy();
			clearInterval(tick);
		};
	});

	let mostRecentBidPlacedAt = $derived.by(() => {
		const relevant = liveBids.filter((bid) => bid.phase === 'silent' && !bid.voided_at);
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
	<div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-8 pt-4">
		<LiveClock {now} />
		<RealtimeStatusBanner status={connectionStatus} />
		<LastBidTimestamp placedAt={mostRecentBidPlacedAt} />
	</div>
	<SilentAuctionTVBoard
		tournament={data.tournament}
		players={data.players}
		{liveBids}
		{bidsReady}
	/>
</div>
