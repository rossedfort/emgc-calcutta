<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
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
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { currentHighBid } from '$lib/bids';
	import {
		PLAYER_STATUSES,
		formatPlayerName,
		playerStatusBadgeVariant,
		playerStatusLabel
	} from '$lib/players';
	import { groupPlayersByFlight } from '$lib/flightGroups';
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
			threshold_amount: number;
			min_increment: number;
		};
		players: FieldPlayerRow[];
		liveBids: RealtimeBid[];
		currentUserId: string;
		supabase: SupabaseClient<Database>;
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

	function suggestedBid(playerId: string): number {
		const high = currentHighBid(liveBids, playerId);
		return high ? high.amount + tournament.min_increment : tournament.min_increment;
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

		const { error: invokeError } = await supabase.functions.invoke<PlaceBidResponse>('place-bid', {
			body: { playerId, amount } satisfies PlaceBidRequest
		});

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

{#if filteredPlayers.length === 0}
	<EmptyState title="No players match these filters" />
{:else}
	<Table.Root>
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
						<Table.Cell class="font-data">{player.handicap_index ?? '—'}</Table.Cell>
						<Table.Cell>
							<Badge variant={playerStatusBadgeVariant(player.status)}>
								{playerStatusLabel(player.status)}
							</Badge>
						</Table.Cell>
						<Table.Cell class="font-data">
							{high ? formatCurrency(high.amount) : 'No bids yet'}
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
											class="w-32"
										/>
										<Button type="submit" variant="brass" disabled={bidPending[player.id]}>
											{bidPending[player.id] ? 'Bidding…' : 'Bid'}
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
{/if}
