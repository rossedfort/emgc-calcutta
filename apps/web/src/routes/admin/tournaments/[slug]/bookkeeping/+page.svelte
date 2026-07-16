<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';

	let { data } = $props();
	let { supabase, players, payouts } = $derived(data);

	let pendingBidId: string | null = $state(null);
	let pendingPayoutId: string | null = $state(null);
	let errorMessage = $state('');

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	async function markBidPaid(playerId: string) {
		pendingBidId = playerId;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('mark-bid-paid', {
			body: { playerId }
		});

		if (error) {
			errorMessage = 'Failed to mark this bid paid';
			if (error instanceof FunctionsHttpError) {
				const body = await error.context.json().catch(() => null);
				if (body?.error) errorMessage = body.error;
			}
		} else {
			await invalidateAll();
		}

		pendingBidId = null;
	}

	async function markPayoutPaid(payoutId: string) {
		pendingPayoutId = payoutId;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('mark-payout-paid', {
			body: { payoutId }
		});

		if (error) {
			errorMessage = 'Failed to mark this payout paid';
			if (error instanceof FunctionsHttpError) {
				const body = await error.context.json().catch(() => null);
				if (body?.error) errorMessage = body.error;
			}
		} else {
			await invalidateAll();
		}

		pendingPayoutId = null;
	}
</script>

<div class="flex flex-col gap-8 pt-4">
	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	<div class="flex flex-col gap-2">
		<h2 class="font-display text-lg font-semibold text-ink">Winning bids — owed to the pot</h2>
		{#if players.length === 0}
			<p class="text-sm text-muted-foreground">No sold players yet.</p>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Player</Table.Head>
						<Table.Head>Buyer</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each players as player (player.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">{player.name}</Table.Cell>
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
							<Table.Cell>
								{#if player.buyer_marked_paid_at}
									<Badge variant="fairway">Paid</Badge>
								{:else}
									<Badge variant="sand">Owed</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if !player.buyer_marked_paid_at}
									<Button
										variant="brass"
										size="sm"
										disabled={pendingBidId === player.id}
										onclick={() => markBidPaid(player.id)}
									>
										Mark paid
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	<div class="flex flex-col gap-2">
		<h2 class="font-display text-lg font-semibold text-ink">Payouts — owed from the pot</h2>
		{#if payouts.length === 0}
			<p class="text-sm text-muted-foreground">
				No payouts yet — these appear once placements are entered.
			</p>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Placement</Table.Head>
						<Table.Head>Player</Table.Head>
						<Table.Head>Winner</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each payouts as payout (payout.id)}
						<Table.Row>
							<Table.Cell class="font-data">{payout.placement}</Table.Cell>
							<Table.Cell class="font-medium text-ink">{payout.player?.name ?? '—'}</Table.Cell>
							<Table.Cell>
								{#if payout.bidder}
									{payout.bidder.name ?? payout.bidder.email}
								{:else}
									<span class="text-muted-foreground">—</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="font-data">{formatCurrency(payout.amount)}</Table.Cell>
							<Table.Cell>
								{#if payout.marked_paid_at}
									<Badge variant="fairway">Paid</Badge>
								{:else}
									<Badge variant="sand">Owed</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if !payout.marked_paid_at}
									<Button
										variant="brass"
										size="sm"
										disabled={pendingPayoutId === payout.id}
										onclick={() => markPayoutPaid(payout.id)}
									>
										Mark paid
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
