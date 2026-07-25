<script lang="ts">
	import { onMount } from 'svelte';
	import type { RealtimeBid, RealtimePlayer } from '@emgc-calcutta/shared-types';
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MultiSelectFilter from '$lib/components/MultiSelectFilter.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { currentHighBid } from '$lib/bids';
	import { PLAYER_STATUSES, formatPlayerName, playerStatusLabel } from '$lib/players';
	import { groupPlayersByFlight } from '$lib/flightGroups';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';
	import { formatCountdown, formatRelativeTime } from '$lib/time';
	import { tournamentPhase } from '$lib/tournamentPhase';

	let { data } = $props();

	let liveBids = $state<RealtimeBid[]>([]);
	let livePlayers = $state<RealtimePlayer[]>([]);
	let connectionStatus = $state<RealtimeConnectionStatus>('connecting');
	// Ticks every second so the phase banner, its countdown, and every row's
	// "time since last bid" all stay live — none of those are otherwise a
	// tracked reactive dependency, same reasoning as /auction/silent's own
	// ticking clock.
	let now = $state(new Date());

	onMount(() => {
		const rt = createTournamentRealtime(data.supabase, data.tournament.id);
		const unsubBids = rt.bids.subscribe((bids) => (liveBids = bids));
		const unsubPlayers = rt.players.subscribe((players) => (livePlayers = players));
		const unsubConnection = rt.connectionStatus.subscribe((s) => (connectionStatus = s));
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => {
			unsubBids();
			unsubPlayers();
			unsubConnection();
			rt.destroy();
			clearInterval(tick);
		};
	});

	// The Realtime store only carries id+status (see $lib/stores/realtime.ts)
	// — it's meant to overlay onto the fuller SSR snapshot, not replace it,
	// same pattern as /auction/silent.
	let players = $derived(
		data.players.map((player) => {
			const live = livePlayers.find((p) => p.id === player.id);
			return live ? { ...player, status: live.status as typeof player.status } : player;
		})
	);

	let phase = $derived(tournamentPhase(data.tournament, now));
	let countdownText = $derived(phase.countdownTo ? formatCountdown(phase.countdownTo, now) : null);

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let searchQuery = $state('');
	let statusFilters = $state<string[]>([]);
	let flightFilters = $state<string[]>([]);

	let statusOptions = $derived(
		PLAYER_STATUSES.map((status) => ({ value: status, label: playerStatusLabel(status) }))
	);
	let flightOptions = $derived(
		data.tournament.flights.map((flight) => ({ value: flight, label: flight }))
	);

	let filteredPlayers = $derived(
		players.filter((p) => {
			if (statusFilters.length > 0 && !statusFilters.includes(p.status)) return false;
			if (flightFilters.length > 0 && !flightFilters.includes(p.flight)) return false;
			if (
				searchQuery.trim() &&
				!formatPlayerName(p).toLowerCase().includes(searchQuery.trim().toLowerCase())
			) {
				return false;
			}
			return true;
		})
	);

	// currentHighBid is already phase-agnostic (highest non-voided Bid, full
	// stop) — silent and live bids write to the same table through the same
	// place-bid function, so this shows the right "current bid" (and, since
	// bids only ever increase, the same bid's placed_at as "last bid")
	// regardless of which phase the tournament is actually in.
	let groupedPlayers = $derived(groupPlayersByFlight(filteredPlayers, data.tournament.flights));
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Players" eyebrow={data.tournament.name} />

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

		{#if phase.phase === 'silent'}
			<Button
				href={resolve('/tournaments/[slug]/auction/silent', { slug: data.tournament.slug })}
				variant="fairway"
				size="sm">Go bid →</Button
			>
		{:else if phase.phase === 'live'}
			<Button
				href={resolve('/tournaments/[slug]/auction/live', { slug: data.tournament.slug })}
				variant="brass"
				size="sm">Go bid →</Button
			>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-4 text-sm">
		<Input type="search" placeholder="Search players…" bind:value={searchQuery} class="max-w-56" />
		<MultiSelectFilter label="Status" options={statusOptions} bind:selected={statusFilters} />
		{#if flightOptions.length > 0}
			<MultiSelectFilter label="Flight" options={flightOptions} bind:selected={flightFilters} />
		{/if}
	</div>

	{#if filteredPlayers.length === 0}
		<EmptyState title="No players match these filters" />
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Name</Table.Head>
					<Table.Head>Flight</Table.Head>
					<Table.Head>Handicap</Table.Head>
					<Table.Head>Current bid</Table.Head>
					<Table.Head>Last bid</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each groupedPlayers as { group, players } (group.flight)}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell
							colspan={5}
							class="font-data text-xs tracking-widest text-fairway uppercase"
						>
							{group.label}
						</Table.Cell>
					</Table.Row>
					{#each players as player (player.id)}
						{@const high = currentHighBid(liveBids, player.id)}
						{@const isYou = player.user_id === data.currentUserId}
						<Table.Row class={player.status === 'reserved' ? 'bg-flag/10' : ''}>
							<Table.Cell class="font-medium text-ink">
								<a
									href={resolve('/tournaments/[slug]/players/[playerSlug]', {
										slug: data.tournament.slug,
										playerSlug: player.slug
									})}
									class="hover:underline">{formatPlayerName(player)}</a
								>
								<DivisionBadge division={player.division} />
								{#if isYou}
									<Badge variant="brass">This is you</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell>{player.flight || '—'}</Table.Cell>
							<Table.Cell class="font-data">{player.handicap_index ?? '—'}</Table.Cell>
							<Table.Cell class="font-data">
								{high ? formatCurrency(high.amount) : 'No bids yet'}
							</Table.Cell>
							<Table.Cell class="text-ink/70">
								{high ? formatRelativeTime(new Date(high.placed_at), now) : '—'}
							</Table.Cell>
						</Table.Row>
					{/each}
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
