<script lang="ts">
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data } = $props();
	let { owed, won } = $derived(data);

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let totalOwedUnpaid = $derived(
		owed
			.filter((row) => !row.buyer_marked_paid_at)
			.reduce((sum, row) => sum + (row.winning_bid?.amount ?? 0), 0)
	);
	let totalWonUnpaid = $derived(
		won.filter((row) => !row.marked_paid_at).reduce((sum, row) => sum + row.amount, 0)
	);

	function ordinal(n: number): string {
		const suffixes = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
	}
</script>

<div class="flex flex-col gap-8">
	<PageHeader title="My balance" eyebrow="Self" />

	<div class="flex flex-col gap-2">
		<div class="flex items-baseline justify-between">
			<h2 class="font-display text-lg font-semibold text-ink">What you owe</h2>
			{#if totalOwedUnpaid > 0}
				<span class="font-data text-sm text-ink">{formatCurrency(totalOwedUnpaid)} unpaid</span>
			{/if}
		</div>

		{#if owed.length === 0}
			<EmptyState title="You haven't won any players yet" />
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Tournament</Table.Head>
						<Table.Head>Player</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each owed as row (row.id)}
						<Table.Row>
							<Table.Cell>{row.tournament?.name ?? '—'}</Table.Cell>
							<Table.Cell class="font-medium text-ink">
								{row.name}
								<DivisionBadge division={row.division} />
							</Table.Cell>
							<Table.Cell class="font-data">
								{row.winning_bid ? formatCurrency(row.winning_bid.amount) : '—'}
							</Table.Cell>
							<Table.Cell>
								{#if row.buyer_marked_paid_at}
									<Badge variant="fairway">Paid</Badge>
								{:else}
									<Badge variant="sand">Owed</Badge>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	<div class="flex flex-col gap-2">
		<div class="flex items-baseline justify-between">
			<h2 class="font-display text-lg font-semibold text-ink">What you've won</h2>
			{#if totalWonUnpaid > 0}
				<span class="font-data text-sm text-ink">{formatCurrency(totalWonUnpaid)} owed to you</span>
			{/if}
		</div>

		{#if won.length === 0}
			<EmptyState title="No payouts yet" />
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Tournament</Table.Head>
						<Table.Head>Player</Table.Head>
						<Table.Head>Placement</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each won as row (row.id)}
						<Table.Row>
							<Table.Cell>{row.tournament?.name ?? '—'}</Table.Cell>
							<Table.Cell class="font-medium text-ink">
								{row.player?.name ?? '—'}
								{#if row.player}
									<DivisionBadge division={row.player.division} />
								{/if}
							</Table.Cell>
							<Table.Cell class="font-data">{ordinal(row.placement)}</Table.Cell>
							<Table.Cell class="font-data">{formatCurrency(row.amount)}</Table.Cell>
							<Table.Cell>
								{#if row.marked_paid_at}
									<Badge variant="fairway">Paid</Badge>
								{:else}
									<Badge variant="sand">Owed</Badge>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
