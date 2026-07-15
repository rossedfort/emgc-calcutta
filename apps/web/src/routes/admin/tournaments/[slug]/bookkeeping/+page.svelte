<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';

	let { data } = $props();
	let { supabase, players } = $derived(data);

	let pendingId: string | null = $state(null);
	let errorMessage = $state('');

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	async function markPaid(playerId: string) {
		pendingId = playerId;
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

		pendingId = null;
	}
</script>

<div class="flex flex-col gap-4 pt-4">
	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

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
									disabled={pendingId === player.id}
									onclick={() => markPaid(player.id)}
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
