<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		RealtimeBid,
		RealtimeLiveLot,
		RealtimePlayerEntry
	} from '@emgc-calcutta/shared-types';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';
	import { formatCountdown } from '$lib/time';
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
	// Ticks every second so the phase banner/countdown and whichever child
	// board is active (the silent board's bid forms, the live board's
	// anti-snipe countdown, the roster's "time since last bid") all stay
	// live — none of those are otherwise a tracked reactive dependency.
	let now = $state(new Date());

	onMount(() => {
		const rt = createTournamentRealtime(data.supabase, data.tournament.id);
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

	// The Realtime store only carries id+status (see $lib/stores/realtime.ts)
	// — it's meant to overlay onto the fuller SSR snapshot, not replace it.
	let players = $derived(
		data.players.map((player) => {
			const live = liveEntries.find((e) => e.id === player.id);
			return live ? { ...player, status: live.status as typeof player.status } : player;
		})
	);

	let phase = $derived(tournamentPhase(data.tournament, now));
	let countdownText = $derived(phase.countdownTo ? formatCountdown(phase.countdownTo, now) : null);

	let isLinkedToYou = $derived(players.some((p) => p.user_id === data.currentUserId));
</script>

<div class="flex flex-col gap-4">
	<PageHeader title={data.tournament.name} eyebrow={phase.label} />

	<RealtimeStatusBanner status={connectionStatus} />

	<div
		class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brass/30 bg-scorecard/40 p-4"
	>
		<div class="flex items-center gap-2 text-sm">
			<span
				class={[
					'inline-block size-2 rounded-full',
					phase.phase === 'silent' || phase.phase === 'live' ? 'bg-fairway' : 'bg-brass/60'
				]}
			></span>
			<span class="font-medium text-ink">{phase.label}</span>
			{#if countdownText}
				<span class="font-data rounded border border-brass/50 px-2 py-0.5 text-xs text-brass">
					{phase.countdownLabel}
					{countdownText}
				</span>
			{/if}
		</div>
	</div>

	{#if !isLinkedToYou}
		<SelfLinkModal unlinkedPlayers={data.unlinkedPlayers} />
	{/if}

	{#if phase.phase === 'silent'}
		<SilentAuctionBoard
			tournament={data.tournament}
			{players}
			{liveBids}
			currentUserId={data.currentUserId}
			supabase={data.supabase}
		/>
	{:else if phase.phase === 'live'}
		<LiveAuctionBoard
			tournament={data.tournament}
			{players}
			{liveBids}
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
