<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { formatPlayerName } from '$lib/players';
	import { formatUserName } from '$lib/profile';

	let { data } = $props();
	let { supabase, players, payoutGroups } = $derived(data);

	function roleLabel(role: 'buyer' | 'golfer' | null): string {
		switch (role) {
			case 'buyer':
				return 'Buyer share';
			case 'golfer':
				return 'Bought back by';
			default:
				return '';
		}
	}

	let pendingBidId: string | null = $state(null);
	let pendingPayoutId: string | null = $state(null);
	let errorMessage = $state('');

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	async function markBidPaid(entryId: string) {
		pendingBidId = entryId;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('mark-bid-paid', {
			body: { entryId }
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
			<EmptyState title="No sold players yet" />
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
							<Table.Cell class="font-medium text-ink">
								{formatPlayerName(player)}
								<DivisionBadge division={player.division} />
							</Table.Cell>
							<Table.Cell>
								{#if player.winning_bid?.bidder}
									{formatUserName(player.winning_bid.bidder) ?? player.winning_bid.bidder.email}
								{:else}
									<span class="text-muted-foreground">—</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="font-data whitespace-nowrap">
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
		{#if payoutGroups.length === 0}
			<EmptyState title="No payouts yet" description="These appear once placements are entered." />
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
					{#each payoutGroups as group (group.entryId)}
						{#if group.rows.length === 1}
							{@const payout = group.rows[0]}
							<Table.Row>
								<Table.Cell class="font-data">{group.placement}</Table.Cell>
								<Table.Cell class="font-medium text-ink">
									{group.player ? formatPlayerName(group.player) : '—'}
									{#if group.player}
										<DivisionBadge division={group.player.division} />
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if payout.bidder}
										{formatUserName(payout.bidder) ?? payout.bidder.email}
									{:else}
										<span class="text-muted-foreground">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="font-data whitespace-nowrap"
									>{formatCurrency(payout.amount)}</Table.Cell
								>
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
						{:else}
							<!-- Split payout (Phase 14: an accepted stake buy-back) — a
							     parent row for the placement/player/total, then one
							     sub-row per recipient rather than presenting the two as
							     unrelated payouts. -->
							<Table.Row class="bg-brass/5">
								<Table.Cell class="font-data">{group.placement}</Table.Cell>
								<Table.Cell class="font-medium text-ink">
									{group.player ? formatPlayerName(group.player) : '—'}
									{#if group.player}
										<DivisionBadge division={group.player.division} />
									{/if}
								</Table.Cell>
								<Table.Cell class="text-ink/60">Split — {group.rows.length} recipients</Table.Cell>
								<Table.Cell class="font-data font-medium whitespace-nowrap">
									{formatCurrency(group.totalAmount)}
								</Table.Cell>
								<Table.Cell></Table.Cell>
								<Table.Cell></Table.Cell>
							</Table.Row>
							{#each group.rows as payout (payout.id)}
								<Table.Row>
									<Table.Cell></Table.Cell>
									<Table.Cell class="pl-6 text-sm text-ink/60">{roleLabel(payout.role)}</Table.Cell>
									<Table.Cell>
										{#if payout.bidder}
											{formatUserName(payout.bidder) ?? payout.bidder.email}
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="font-data whitespace-nowrap"
										>{formatCurrency(payout.amount)}</Table.Cell
									>
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
						{/if}
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
