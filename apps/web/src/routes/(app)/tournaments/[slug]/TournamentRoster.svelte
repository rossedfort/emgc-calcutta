<script lang="ts">
	import type { RealtimeBid } from '@emgc-calcutta/shared-types';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MultiSelectFilter from '$lib/components/MultiSelectFilter.svelte';
	import PlayerListCard from '$lib/components/PlayerListCard.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { currentHighBid } from '$lib/bids';
	import {
		PLAYER_STATUSES,
		formatHandicapIndex,
		formatPlayerName,
		playerStatusLabel
	} from '$lib/players';
	import { groupPlayersByFlight } from '$lib/flightGroups';
	import { routes } from '$lib/routes';
	import { formatRelativeTime } from '$lib/time';
	import type { FieldPlayerRow } from './+page.server';

	let {
		tournament,
		players,
		liveBids,
		currentUserId,
		now
	}: {
		tournament: { slug: string; flights: string[] };
		players: FieldPlayerRow[];
		liveBids: RealtimeBid[];
		currentUserId: string;
		now: Date;
	} = $props();

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
		tournament.flights.map((flight) => ({ value: flight, label: flight }))
	);

	// currentHighBid is already phase-agnostic (highest non-voided Bid, full
	// stop) — silent and live bids write to the same table through the same
	// place-bid function, so this shows the right "current bid" (and, since
	// bids only ever increase, the same bid's placed_at as "last bid")
	// regardless of which phase the tournament has already been through.
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

	let groupedPlayers = $derived(groupPlayersByFlight(filteredPlayers, tournament.flights));
</script>

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
	<Table.Root class="hidden md:table">
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
								href={routes.tournamentPlayer(tournament.slug, player.slug)}
								class="hover:underline">{formatPlayerName(player)}</a
							>
							<DivisionBadge division={player.division} />
							{#if isYou}
								<Badge variant="brass">This is you</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell>{player.flight || '—'}</Table.Cell>
						<Table.Cell class="font-data whitespace-nowrap"
							>{formatHandicapIndex(player.handicap_index)}</Table.Cell
						>
						<Table.Cell class="font-data whitespace-nowrap">
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

	<div class="flex flex-col gap-4 md:hidden">
		{#each groupedPlayers as { group, players } (group.flight)}
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
							reserved={player.status === 'reserved'}
						>
							<div class="flex items-baseline justify-between gap-2">
								<div>
									<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
										Current bid
									</p>
									<p class="font-data text-lg">
										{high ? formatCurrency(high.amount) : 'No bids yet'}
									</p>
								</div>
								<p class="text-xs text-ink/70">
									{high ? formatRelativeTime(new Date(high.placed_at), now) : ''}
								</p>
							</div>
						</PlayerListCard>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/if}
