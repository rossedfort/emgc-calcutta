<script lang="ts">
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import { formatPlayerName } from '$lib/players';

	let { data } = $props();
	let { results, payoutStructure, tournamentSlug } = $derived(data);

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	const payoutEntries = $derived(
		Object.entries(payoutStructure)
			.map(([place, share]) => [Number(place), share] as const)
			.sort((a, b) => a[0] - b[0])
	);

	// Same "skip individually-empty groups, but treat all-empty as the
	// page-level empty state" behavior as the admin results page.
	let nonEmptyResults = $derived(results.filter((r) => r.players.length > 0));
</script>

<div class="flex flex-col gap-4 pt-4">
	{#if payoutEntries.length > 0}
		<p class="text-sm text-muted-foreground">
			Payout structure:
			{#each payoutEntries as [place, share], i (place)}
				{i > 0 ? ', ' : ''}{place}{place === 1
					? 'st'
					: place === 2
						? 'nd'
						: place === 3
							? 'rd'
							: 'th'} = {(share * 100).toFixed(0)}%
			{/each}
		</p>
	{/if}

	{#if nonEmptyResults.length === 0}
		<EmptyState title="No results to show" description="Nothing was sold in this tournament." />
	{:else}
		<div class="flex flex-col gap-6">
			{#each nonEmptyResults as { group, players } (`${group.flight}::${group.division}`)}
				<div class="flex flex-col gap-2">
					<h3 class="font-data text-xs tracking-widest text-fairway uppercase">
						{group.label}
					</h3>
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Placement</Table.Head>
								<Table.Head>Player</Table.Head>
								<Table.Head>Won by</Table.Head>
								<Table.Head>Winning bid</Table.Head>
								<Table.Head>Payout</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each players as player (player.id)}
								<Table.Row>
									<Table.Cell class="font-data">{player.placement ?? '—'}</Table.Cell>
									<Table.Cell class="font-medium text-ink">
										{formatPlayerName(player)}
										<DivisionBadge division={player.division} />
									</Table.Cell>
									<Table.Cell>
										{#if player.winning_bid?.bidder_name}
											{player.winning_bid.bidder_name}
										{:else if player.viaField}
											<span class="text-ink/70">{player.viaField.bidderName ?? '—'}</span>
											<a
												href={resolve('/tournaments/[slug]/players/[playerSlug]', {
													slug: tournamentSlug,
													playerSlug: player.viaField.slug
												})}
												class="block text-xs text-brass hover:underline"
											>
												via {player.viaField.name}
											</a>
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="font-data whitespace-nowrap">
										{player.winning_bid ? formatCurrency(player.winning_bid.amount) : '—'}
									</Table.Cell>
									<Table.Cell class="font-data whitespace-nowrap">
										{#if player.payout}
											{formatCurrency(player.payout.amount)}
											<Badge variant="fairway">{(player.payout.pot_share * 100).toFixed(0)}%</Badge>
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/each}
		</div>
	{/if}
</div>
