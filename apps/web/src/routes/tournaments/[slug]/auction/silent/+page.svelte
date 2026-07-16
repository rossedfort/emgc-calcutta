<script lang="ts">
	import { onMount } from 'svelte';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type {
		ErrorResponse,
		PlaceBidRequest,
		PlaceBidResponse,
		RealtimeBid,
		RealtimePlayer
	} from '@emgc-calcutta/shared-types';
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { currentHighBid } from '$lib/bids';
	import { PLAYER_STATUSES, playerStatusBadgeVariant, playerStatusLabel } from '$lib/players';
	import { createTournamentRealtime } from '$lib/stores/realtime';

	let { data } = $props();

	let liveBids = $state<RealtimeBid[]>([]);
	let livePlayers = $state<RealtimePlayer[]>([]);
	// Ticks every second so both auctionOpen and the countdown stay live —
	// without this, auctionOpen would freeze at whatever it evaluated to on
	// first render, since `new Date()` alone isn't a tracked reactive
	// dependency (nothing else on this page changes as the clock ticks).
	let now = $state(new Date());

	onMount(() => {
		const rt = createTournamentRealtime(data.supabase, data.tournament.id);
		const unsubBids = rt.bids.subscribe((bids) => (liveBids = bids));
		const unsubPlayers = rt.players.subscribe((players) => (livePlayers = players));
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => {
			unsubBids();
			unsubPlayers();
			rt.destroy();
			clearInterval(tick);
		};
	});

	// The Realtime store only carries id+status (see $lib/stores/realtime.ts)
	// — it's meant to overlay onto the fuller SSR snapshot, not replace it.
	let players = $derived(
		data.players.map((player) => {
			const live = livePlayers.find((p) => p.id === player.id);
			return live ? { ...player, status: live.status as typeof player.status } : player;
		})
	);

	let auctionEnd = $derived(new Date(data.tournament.silent_auction_end));
	let auctionOpen = $derived(
		now >= new Date(data.tournament.silent_auction_start) && now <= auctionEnd
	);

	let timeRemaining = $derived.by(() => {
		const totalSeconds = Math.floor((auctionEnd.getTime() - now.getTime()) / 1000);
		if (totalSeconds <= 0) return null;
		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const pad = (n: number) => n.toString().padStart(2, '0');
		return days > 0
			? `${days}d ${pad(hours)}h ${pad(minutes)}m`
			: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	});

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let searchQuery = $state('');
	let statusFilter = $state('all');
	let flightFilter = $state('all');

	let flights = $derived(
		[...new Set(players.map((p) => p.flight).filter((f): f is string => !!f))].sort()
	);

	let filteredPlayers = $derived(
		players.filter((p) => {
			if (statusFilter !== 'all' && p.status !== statusFilter) return false;
			if (flightFilter !== 'all' && p.flight !== flightFilter) return false;
			if (searchQuery.trim() && !p.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
				return false;
			}
			return true;
		})
	);

	function suggestedBid(playerId: string): number {
		const high = currentHighBid(liveBids, playerId);
		return high ? high.amount + data.tournament.min_increment : data.tournament.min_increment;
	}

	// The underlying <input type="number"> binds its value as a number (or
	// '' when empty), not a string, despite `type` being a dynamic prop on
	// the Input wrapper rather than a literal — so this has to accept both.
	let bidAmounts = $state<Record<string, string | number>>({});
	let bidPending = $state<Record<string, boolean>>({});
	let bidErrors = $state<Record<string, string>>({});

	async function placeBid(playerId: string) {
		const raw = bidAmounts[playerId];
		const amount = raw === undefined || raw === '' ? suggestedBid(playerId) : Number(raw);
		if (!Number.isFinite(amount) || amount <= 0) {
			bidErrors[playerId] = 'Enter a valid bid amount';
			return;
		}

		bidPending[playerId] = true;
		bidErrors[playerId] = '';

		const { error: invokeError } = await data.supabase.functions.invoke<PlaceBidResponse>(
			'place-bid',
			{ body: { playerId, amount } satisfies PlaceBidRequest }
		);

		bidPending[playerId] = false;

		if (invokeError) {
			// place-bid's actual { error: string } body is on
			// invokeError.context (a Response), not thrown as the message —
			// supabase-js only gives a generic "non-2xx status code" message
			// otherwise.
			let message = invokeError.message;
			if (invokeError instanceof FunctionsHttpError) {
				const body = (await invokeError.context.json().catch(() => null)) as ErrorResponse | null;
				message = body?.error ?? message;
			}
			bidErrors[playerId] = message;
			return;
		}

		bidAmounts[playerId] = '';
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Silent auction" eyebrow={data.tournament.name} />

	<div class="flex items-center gap-2 text-sm">
		<span class={['inline-block size-2 rounded-full', auctionOpen ? 'bg-fairway' : 'bg-brass/60']}
		></span>
		<span>
			{#if auctionOpen}
				Open — closes {auctionEnd.toLocaleString('en-US', {
					month: 'long',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit'
				})}
			{:else}
				Closed
			{/if}
		</span>
		{#if auctionOpen && timeRemaining}
			<span class="font-data rounded border border-brass/50 px-2 py-0.5 text-xs text-brass">
				{timeRemaining} left
			</span>
		{/if}
	</div>

	<p class="text-sm text-ink/70">
		Bids of {formatCurrency(data.tournament.threshold_amount)} or more reserve a player for the live auction
		— each new bid must beat the current high by at least {formatCurrency(
			data.tournament.min_increment
		)}.
	</p>

	<div class="flex flex-wrap items-center gap-4 text-sm">
		<Input type="search" placeholder="Search players…" bind:value={searchQuery} class="max-w-56" />
		<label class="flex items-center gap-2">
			<span class="text-muted-foreground">Status</span>
			<select
				bind:value={statusFilter}
				class="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
			>
				<option value="all">All</option>
				{#each PLAYER_STATUSES as status (status)}
					<option value={status}>{playerStatusLabel(status)}</option>
				{/each}
			</select>
		</label>
		{#if flights.length > 0}
			<label class="flex items-center gap-2">
				<span class="text-muted-foreground">Flight</span>
				<select
					bind:value={flightFilter}
					class="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
				>
					<option value="all">All</option>
					{#each flights as flight (flight)}
						<option value={flight}>{flight}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>

	{#if filteredPlayers.length === 0}
		<p class="text-sm text-muted-foreground">No players match these filters.</p>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each filteredPlayers as player (player.id)}
				{@const high = currentHighBid(liveBids, player.id)}
				{@const isYou = player.user_id === data.currentUserId}
				{@const metaLine = [
					player.flight ? `Flight ${player.flight}` : null,
					player.handicap_index !== null ? `HCP ${player.handicap_index}` : null
				]
					.filter(Boolean)
					.join(' · ')}
				<div
					class={[
						'flex flex-col gap-3 rounded-lg border bg-scorecard p-4 text-ink',
						player.status === 'reserved' ? 'border-flag/50 ring-1 ring-flag/30' : 'border-brass/30'
					]}
				>
					<div class="flex items-start justify-between gap-2">
						<div class="flex flex-col gap-0.5">
							<a
								href={resolve('/tournaments/[slug]/players/[playerSlug]', {
									slug: data.tournament.slug,
									playerSlug: player.slug
								})}
								class="font-display text-lg font-semibold text-ink hover:underline"
							>
								{player.name}
							</a>
							<DivisionBadge division={player.division} />
							{#if metaLine}
								<span class="font-data text-xs tracking-wide text-ink/60 uppercase">
									{metaLine}
								</span>
							{/if}
						</div>
						<Badge variant={playerStatusBadgeVariant(player.status)}>
							{playerStatusLabel(player.status)}
						</Badge>
					</div>

					{#if isYou}
						<Badge variant="brass">This is you</Badge>
					{/if}

					<div class="flex flex-col gap-1 border-t border-brass/40 pt-3">
						<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
							Current high
						</span>
						<span class="font-data text-lg text-ink">
							{high ? formatCurrency(high.amount) : 'No bids yet'}
						</span>
					</div>

					{#if player.status === 'open' && auctionOpen}
						<form
							class="flex flex-col gap-2"
							onsubmit={(event) => {
								event.preventDefault();
								placeBid(player.id);
							}}
						>
							<div class="flex items-center gap-2">
								<Input
									type="number"
									step="0.01"
									min="0.01"
									placeholder={suggestedBid(player.id).toFixed(2)}
									bind:value={bidAmounts[player.id]}
									disabled={bidPending[player.id]}
								/>
								<Button type="submit" variant="brass" disabled={bidPending[player.id]}>
									{bidPending[player.id] ? 'Bidding…' : 'Bid'}
								</Button>
							</div>
							{#if bidErrors[player.id]}
								<p class="text-xs text-flag">{bidErrors[player.id]}</p>
							{/if}
						</form>
					{:else if player.status === 'open'}
						<p class="text-xs text-ink/60">The silent auction isn't open.</p>
					{:else}
						<p class="text-xs text-ink/60">Not open for silent bidding.</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
