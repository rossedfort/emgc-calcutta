<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';
	import BuyBackModal from '$lib/components/BuyBackModal.svelte';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { formatPlayerName } from '$lib/players';
	import type { OwedRow, StakeRow } from './+page.server';

	let { data } = $props();
	let { supabase, tournament, owed, won, stake } = $derived(data);

	let buyBackModalOpen = $state(false);
	let selectedStakeRow = $state<StakeRow | null>(null);

	function openBuyBackModal(row: StakeRow) {
		selectedStakeRow = row;
		buyBackModalOpen = true;
	}

	// Keyed by entry id, not a single shared flag — responding to one
	// row's request shouldn't disable every other row's buttons too.
	let respondingTo = $state<Record<string, boolean>>({});
	let respondError = $state<Record<string, string>>({});

	async function respondToBuyback(row: OwedRow, decision: 'accept' | 'reject') {
		respondingTo[row.id] = true;
		respondError[row.id] = '';

		const { error } = await supabase.functions.invoke('respond-stake-buyback', {
			body: { entryId: row.id, decision }
		});

		respondingTo[row.id] = false;

		if (error) {
			let message = `Failed to ${decision} the request`;
			if (error instanceof FunctionsHttpError) {
				const body = await error.context.json().catch(() => null);
				if (body?.error) message = body.error;
			}
			respondError[row.id] = message;
			return;
		}

		await invalidateAll();
	}

	function stakeBuybackBadge(row: StakeRow): {
		label: string;
		variant: 'fairway' | 'flag' | 'sand';
	} {
		switch (row.stake_buyback_status) {
			case 'accepted':
				return { label: 'Buy-back accepted', variant: 'fairway' };
			case 'pending':
				return { label: 'Buy-back requested', variant: 'sand' };
			case 'rejected':
				return { label: 'Buy-back declined', variant: 'flag' };
			default:
				return { label: 'Sold', variant: 'sand' };
		}
	}

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

<div class="flex flex-col gap-8 pt-4">
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
						<Table.Head>Player</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each owed as row (row.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">
								{formatPlayerName(row)}
								<DivisionBadge division={row.division} />
							</Table.Cell>
							<Table.Cell class="font-data whitespace-nowrap">
								{row.winning_bid ? formatCurrency(row.winning_bid.amount) : '—'}
							</Table.Cell>
							<Table.Cell>
								{#if row.buyer_marked_paid_at}
									<Badge variant="fairway">Paid</Badge>
								{:else}
									<Badge variant="sand">Owed</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if row.pending_buyback}
									{@const buyback = row.pending_buyback}
									{@const requesterName =
										[buyback.requester?.first_name, buyback.requester?.last_name]
											.filter(Boolean)
											.join(' ') || 'They'}
									<div class="flex flex-col items-end gap-1">
										<span class="text-xs text-ink/60">
											{requesterName} wants to buy back {Math.round(buyback.percentage * 100)}% for
											{formatCurrency(buyback.amount)}
										</span>
										{#if respondError[row.id]}
											<span class="text-xs text-destructive">{respondError[row.id]}</span>
										{/if}
										<div class="flex gap-2">
											<Button
												variant="brass"
												size="sm"
												disabled={respondingTo[row.id]}
												onclick={() => respondToBuyback(row, 'reject')}
											>
												Reject
											</Button>
											<Button
												variant="brass"
												size="sm"
												disabled={respondingTo[row.id]}
												onclick={() => respondToBuyback(row, 'accept')}
											>
												Accept
											</Button>
										</div>
									</div>
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
						<Table.Head>Player</Table.Head>
						<Table.Head>Placement</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each won as row (row.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">
								{row.player ? formatPlayerName(row.player) : '—'}
								{#if row.player}
									<DivisionBadge division={row.player.division} />
								{/if}
							</Table.Cell>
							<Table.Cell class="font-data whitespace-nowrap">{ordinal(row.placement)}</Table.Cell>
							<Table.Cell class="font-data whitespace-nowrap"
								>{formatCurrency(row.amount)}</Table.Cell
							>
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

	{#if stake.length > 0}
		<div class="flex flex-col gap-2">
			<h2 class="font-display text-lg font-semibold text-ink">Your stake</h2>

			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Player</Table.Head>
						<Table.Head>Bought for</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each stake as row (row.id)}
						{@const badge = stakeBuybackBadge(row)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">
								{formatPlayerName(row)}
								<DivisionBadge division={row.division} />
							</Table.Cell>
							<Table.Cell class="font-data whitespace-nowrap"
								>{formatCurrency(row.amount)}</Table.Cell
							>
							<Table.Cell class="whitespace-nowrap">
								<Badge variant={badge.variant}>{badge.label}</Badge>
							</Table.Cell>
							<Table.Cell>
								{#if row.can_request}
									<Button variant="brass" size="sm" onclick={() => openBuyBackModal(row)}>
										Buy back stake
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>

{#if selectedStakeRow}
	<BuyBackModal
		bind:open={buyBackModalOpen}
		{supabase}
		entryId={selectedStakeRow.id}
		tournamentName={tournament.name}
		percentage={selectedStakeRow.buy_back_percentage}
		amount={selectedStakeRow.buy_back_amount}
		buyer={selectedStakeRow.buyer ?? { first_name: null, last_name: null, email: '', phone: null }}
		onSuccess={() => invalidateAll()}
	/>
{/if}
