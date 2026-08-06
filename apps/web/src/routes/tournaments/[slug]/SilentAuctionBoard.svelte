<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { onMount } from 'svelte';
	import type {
		Database,
		ErrorResponse,
		PlaceBidRequest,
		PlaceBidResponse,
		RealtimeBid
	} from '@emgc-calcutta/shared-types';
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MultiSelectFilter from '$lib/components/MultiSelectFilter.svelte';
	import PlayerListCard from '$lib/components/PlayerListCard.svelte';
	import SlotMachineDigit from '$lib/components/SlotMachineDigit.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { currentHighBid } from '$lib/bids';
	import {
		PLAYER_STATUSES,
		formatHandicapIndex,
		formatPlayerName,
		playerStatusBadgeVariant,
		playerStatusLabel
	} from '$lib/players';
	import { groupPlayersByFlightAndDivision } from '$lib/flightGroups';
	import type { FieldPlayerRow } from './+page.server';

	let {
		tournament,
		players,
		liveBids,
		currentUserId,
		supabase
	}: {
		tournament: {
			slug: string;
			flights: string[];
			championship_flight: string | null;
			threshold_amount: number;
			min_increment: number;
			bid_anonymity_enabled: boolean;
		};
		players: FieldPlayerRow[];
		liveBids: RealtimeBid[];
		currentUserId: string;
		supabase: SupabaseClient<Database>;
	} = $props();

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	// Stays false through this component's first render, then flips once and
	// for all — used so a player's reels only spin in from zero when their
	// first-ever bid arrives live (a real "no bid" -> "has a bid" transition
	// witnessed on an already-open board), not when the page simply loads on
	// a player who already had a bid (that should snap straight to the
	// current value, no animation).
	let pastInitialLoad = $state(false);
	onMount(() => {
		pastInitialLoad = true;
	});

	let searchQuery = $state('');
	let statusFilters = $state<string[]>([]);
	let flightFilters = $state<string[]>([]);

	let statusOptions = $derived(
		PLAYER_STATUSES.map((status) => ({ value: status, label: playerStatusLabel(status) }))
	);
	let flightOptions = $derived(
		tournament.flights.map((flight) => ({ value: flight, label: flight }))
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

	// Split into (flight, division) sections rather than flight alone — a
	// Championship-flight golfer's Gross and Net rows are two completely
	// independent auction entries (own bids, own "current high"), and
	// sharing one flight section with just an inline badge wasn't a clear
	// enough distinction for a participant actually placing a bid (reported
	// directly). Each section header now reads e.g. "A — Gross"/"A — Net".
	let groupedPlayers = $derived(
		groupPlayersByFlightAndDivision(
			filteredPlayers,
			tournament.flights,
			tournament.championship_flight
		)
	);

	// Splits a formatted amount ("$1,850.00") into characters for the
	// slot-machine effect, each keyed by distance from the *end* of the
	// string rather than the start — bid amounts only ever grow (a bid must
	// beat the current high), so a new leading digit appearing (e.g.
	// "$99.00" -> "$100.00") only ever prepends a character; keying from the
	// right means the existing trailing digits' SlotMachineDigit instances
	// (and the mid-spin state they're holding) keep their identity instead
	// of every position remapping to a different character.
	function currencyChars(formatted: string): { char: string; isDigit: boolean; key: number }[] {
		const chars = formatted.split('');
		return chars.map((char, i) => ({
			char,
			isDigit: char >= '0' && char <= '9',
			key: chars.length - 1 - i
		}));
	}

	function suggestedBid(entryId: string): number {
		const high = currentHighBid(liveBids, entryId);
		return high ? high.amount + tournament.min_increment : tournament.min_increment;
	}

	// The underlying <input type="number"> binds its value as a number (or
	// '' when empty), not a string, despite `type` being a dynamic prop on
	// the Input wrapper rather than a literal — so this has to accept both.
	let bidAmounts = $state<Record<string, string | number>>({});
	let bidPending = $state<Record<string, boolean>>({});
	let bidErrors = $state<Record<string, string>>({});

	async function placeBid(entryId: string) {
		const raw = bidAmounts[entryId];
		const amount = raw === undefined || raw === '' ? suggestedBid(entryId) : Number(raw);
		if (!Number.isFinite(amount) || amount <= 0) {
			bidErrors[entryId] = 'Enter a valid bid amount';
			return;
		}

		bidPending[entryId] = true;
		bidErrors[entryId] = '';

		const { error: invokeError } = await supabase.functions.invoke<PlaceBidResponse>('place-bid', {
			body: { entryId, amount } satisfies PlaceBidRequest
		});

		bidPending[entryId] = false;

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
			bidErrors[entryId] = message;
			return;
		}

		bidAmounts[entryId] = '';
	}
</script>

<p class="text-sm text-ink/70">
	Bids of {formatCurrency(tournament.threshold_amount)} or more reserve a player for the live auction
	— each new bid must beat the current high by at least {formatCurrency(tournament.min_increment)}.
</p>

<div class="flex flex-wrap items-center gap-4 text-sm">
	<Input type="search" placeholder="Search players…" bind:value={searchQuery} class="max-w-56" />
	<MultiSelectFilter label="Status" options={statusOptions} bind:selected={statusFilters} />
	{#if flightOptions.length > 0}
		<MultiSelectFilter label="Flight" options={flightOptions} bind:selected={flightFilters} />
	{/if}
</div>

{#snippet currentHigh(high: RealtimeBid | null)}
	{#if high}
		<span class="inline-flex">
			{#each currencyChars(formatCurrency(high.amount)) as { char, isDigit, key } (key)}
				{#if isDigit}
					<SlotMachineDigit digit={char} delayMs={key * 60} spinIn={pastInitialLoad} />
				{:else}
					<span
						class="inline-block text-center align-bottom"
						style="height: 1.2em; width: 0.62em; line-height: 1.2em;">{char}</span
					>
				{/if}
			{/each}
		</span>
		{#if high.bidder_name && !tournament.bid_anonymity_enabled}
			<span class="ml-1 font-sans text-xs text-ink/60">({high.bidder_name})</span>
		{/if}
	{:else}
		-
	{/if}
{/snippet}

{#if filteredPlayers.length === 0}
	<EmptyState title="No players match these filters" />
{:else}
	<Table.Root class="hidden md:block">
		<Table.Header>
			<Table.Row>
				<Table.Head>Player</Table.Head>
				<Table.Head>Handicap</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head>Current high</Table.Head>
				<Table.Head>Bid</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each groupedPlayers as { group, players } (`${group.flight}::${group.division}`)}
				<Table.Row class="bg-sand/20 hover:bg-sand/20">
					<Table.Cell colspan={5} class="font-data text-xs tracking-widest text-fairway uppercase">
						{group.label}
					</Table.Cell>
				</Table.Row>
				{#each players as player (player.id)}
					{@const high = currentHighBid(liveBids, player.id)}
					{@const isYou = player.user_id === currentUserId}
					<Table.Row class={player.status === 'reserved' ? 'bg-flag/10' : ''}>
						<Table.Cell class="font-medium text-ink">
							<a
								href={resolve('/tournaments/[slug]/players/[playerSlug]', {
									slug: tournament.slug,
									playerSlug: player.slug
								})}
								class="hover:underline">{formatPlayerName(player)}</a
							>
							<DivisionBadge division={player.division} />
							{#if isYou}
								<Badge variant="brass">This is you</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="font-data whitespace-nowrap"
							>{formatHandicapIndex(player.handicap_index)}</Table.Cell
						>
						<Table.Cell class="whitespace-nowrap">
							<Badge variant={playerStatusBadgeVariant(player.status)}>
								{playerStatusLabel(player.status)}
							</Badge>
						</Table.Cell>
						<Table.Cell class="font-data whitespace-nowrap">
							{@render currentHigh(high)}
						</Table.Cell>
						<Table.Cell>
							{#if player.status === 'open'}
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
											class="w-32 shrink-0"
										/>
										<Button
											type="submit"
											variant="brass"
											disabled={bidPending[player.id]}
											class="shrink-0"
										>
											Bid
										</Button>
									</div>
									{#if bidErrors[player.id]}
										<p class="text-xs text-flag">{bidErrors[player.id]}</p>
									{/if}
								</form>
							{:else}
								<p class="text-xs text-ink/60">Not open for bidding.</p>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			{/each}
		</Table.Body>
	</Table.Root>

	<div class="flex flex-col gap-4 md:hidden">
		{#each groupedPlayers as { group, players } (`${group.flight}::${group.division}`)}
			<div class="flex flex-col gap-2">
				<h3 class="font-data text-xs tracking-widest text-fairway uppercase">{group.label}</h3>
				<div class="flex flex-col gap-3">
					{#each players as player (player.id)}
						{@const high = currentHighBid(liveBids, player.id)}
						{@const isYou = player.user_id === currentUserId}
						<PlayerListCard
							slug={tournament.slug}
							playerSlug={player.slug}
							name={formatPlayerName(player)}
							division={player.division}
							{isYou}
							handicap={formatHandicapIndex(player.handicap_index)}
							statusLabel={playerStatusLabel(player.status)}
							statusVariant={playerStatusBadgeVariant(player.status)}
							reserved={player.status === 'reserved'}
						>
							<div class="flex flex-col gap-3">
								<div>
									<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
										Current high
									</p>
									<p class="font-data text-lg">{@render currentHigh(high)}</p>
								</div>
								{#if player.status === 'open'}
									<form
										class="flex items-center gap-2"
										onsubmit={(event) => {
											event.preventDefault();
											placeBid(player.id);
										}}
									>
										<Input
											type="number"
											step="0.01"
											min="0.01"
											placeholder={suggestedBid(player.id).toFixed(2)}
											bind:value={bidAmounts[player.id]}
											disabled={bidPending[player.id]}
											class="min-w-0 flex-1"
										/>
										<Button
											type="submit"
											variant="brass"
											disabled={bidPending[player.id]}
											class="shrink-0"
										>
											Bid
										</Button>
									</form>
									{#if bidErrors[player.id]}
										<p class="text-xs text-flag">{bidErrors[player.id]}</p>
									{/if}
								{:else}
									<p class="text-xs text-ink/60">Not open for bidding.</p>
								{/if}
							</div>
						</PlayerListCard>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/if}
