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
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import LiveAuctionTVBoard from './LiveAuctionTVBoard.svelte';

	// `@` (bare, no name) resets this page's rendered layout all the way to
	// the true root +layout.svelte, skipping every ancestor .svelte between
	// there and here — (app)'s AppShell, admin's plain wrapper, the
	// tournament's PageHeader/tab nav, and the auction sub-nav. This is what
	// actually makes the page shell-less (see admin/tournaments/[slug]/
	// auction/live/+page.svelte's "TV Display" button). It does NOT skip
	// any ancestor *load* functions — admin/+layout.server.ts's role check
	// still runs on every request to this route, same as any other admin
	// page; only the component tree is reset, not the data/auth chain.
	// Because it resets past (app)'s +layout.svelte, app.css (normally
	// loaded there) has to be imported directly here too.
	let { data } = $props();

	let liveBids = $state<RealtimeBid[]>([]);
	let liveEntries = $state<RealtimePlayerEntry[]>([]);
	let liveLots = $state<RealtimeLiveLot[]>([]);
	let connectionStatus = $state<RealtimeConnectionStatus>('connecting');
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
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => {
			unsubBids();
			unsubEntries();
			unsubLots();
			unsubConnection();
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
</script>

<svelte:head>
	<title>{page.data.title}</title>
	<meta name="description" content={page.data.description} />
</svelte:head>

<div class="min-h-screen bg-fairway/5">
	<div class="mx-auto flex max-w-7xl flex-col gap-2 px-8 pt-4">
		<RealtimeStatusBanner status={connectionStatus} />
	</div>
	<LiveAuctionTVBoard
		tournament={data.tournament}
		{players}
		{liveBids}
		{liveLots}
		currentUserId={data.currentUserId}
		supabase={data.supabase}
		{now}
	/>
</div>
