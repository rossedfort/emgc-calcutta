<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import EnterResultsModal from '$lib/components/EnterResultsModal.svelte';
	import { formatPlayerName } from '$lib/players';

	let { data } = $props();
	let { supabase, results, payoutStructure } = $derived(data);

	let editModalOpen = $state(false);

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	const payoutEntries = $derived(
		Object.entries(payoutStructure)
			.map(([place, share]) => [Number(place), share] as const)
			.sort((a, b) => a[0] - b[0])
	);

	// Empty groups (a flight with no sold players yet) are skipped rather
	// than rendered as a heading over nothing — but if *every* group is
	// empty, that's the page-level "nothing sold yet" state, not N
	// individually-empty sections.
	let nonEmptyResults = $derived(results.filter((r) => r.players.length > 0));
</script>

<div class="flex flex-col gap-4 pt-4">
	<div class="flex items-start justify-between gap-4">
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
		{:else}
			<p class="text-sm text-destructive">
				No payout structure configured for this tournament yet — set it on the Settings tab first.
			</p>
		{/if}

		<Button variant="brass" size="sm" onclick={() => (editModalOpen = true)}>Edit results</Button>
	</div>

	{#if nonEmptyResults.length === 0}
		<EmptyState title="No sold players yet" />
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
								<Table.Head>Buyer</Table.Head>
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
										{#if player.winning_bid?.bidder}
											{player.winning_bid.bidder.name ?? player.winning_bid.bidder.email}
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="font-data">
										{player.winning_bid ? formatCurrency(player.winning_bid.amount) : '—'}
									</Table.Cell>
									<Table.Cell class="font-data">
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

<EnterResultsModal
	bind:open={editModalOpen}
	{supabase}
	tournamentId={data.tournament.id}
	flights={data.tournament.flights}
	championshipFlight={data.tournament.championship_flight}
	{payoutStructure}
	onSuccess={() => invalidateAll()}
/>
