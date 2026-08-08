<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import VoidBidDialog from '$lib/components/VoidBidDialog.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { formatPlayerName } from '$lib/players';
	import type { SilentAuctionBidRow } from './+page.server';

	let { data } = $props();
	let { supabase, tournament, bids } = $derived(data);

	let playerFilter = $state('');
	let bidderFilter = $state('');

	// Client-side filtering, matching the participant auction board's own
	// pattern — this table is already scoped to one tournament and capped
	// at 100 rows server-side, the same bounded scale, so there's no need
	// for the audit log's URL-param/server-side approach.
	let filteredBids = $derived(
		bids.filter((bid) => {
			if (
				playerFilter.trim() &&
				!formatPlayerName(bid.player).toLowerCase().includes(playerFilter.trim().toLowerCase())
			)
				return false;
			if (
				bidderFilter.trim() &&
				!(bid.bidder_name ?? '').toLowerCase().includes(bidderFilter.trim().toLowerCase())
			)
				return false;
			return true;
		})
	);

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function formatDateTime(iso: string): string {
		return dateTimeFormatter.format(new Date(iso));
	}

	let voidDialogOpen = $state(false);
	let voidTarget = $state<SilentAuctionBidRow | null>(null);

	function openVoidDialog(bid: SilentAuctionBidRow) {
		voidTarget = bid;
		voidDialogOpen = true;
	}
</script>

<div class="flex flex-col gap-4 pt-4">
	<div class="flex flex-col gap-2">
		<h2 class="font-display text-lg font-semibold text-ink">Recent silent auction bids</h2>
		<p class="text-sm text-ink/60">
			The most recent 100 bids placed during the silent auction. Voiding is soft and reversible by
			an Owner.
		</p>

		{#if bids.length === 0}
			<EmptyState title="No silent auction bids yet" />
		{:else}
			<div class="flex flex-wrap gap-2">
				<Input
					type="search"
					placeholder="Filter by player…"
					bind:value={playerFilter}
					class="max-w-56"
				/>
				<Input
					type="search"
					placeholder="Filter by bidder…"
					bind:value={bidderFilter}
					class="max-w-56"
				/>
			</div>

			{#if filteredBids.length === 0}
				<EmptyState title="No bids match these filters" />
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Player</Table.Head>
							<Table.Head>Bidder</Table.Head>
							<Table.Head>Amount</Table.Head>
							<Table.Head>Placed</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filteredBids as bid (bid.id)}
							<Table.Row>
								<Table.Cell class="font-medium text-ink">
									<a
										href={resolve('/tournaments/[slug]/players/[playerSlug]', {
											slug: tournament.slug,
											playerSlug: bid.player.slug
										})}
										class="hover:underline">{formatPlayerName(bid.player)}</a
									>
									<DivisionBadge division={bid.division} />
								</Table.Cell>
								<Table.Cell>
									{#if bid.bidder_name}
										{bid.bidder_name}
									{:else}
										<span class="text-muted-foreground">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="font-data whitespace-nowrap"
									>{formatCurrency(bid.amount)}</Table.Cell
								>
								<Table.Cell class="font-data whitespace-nowrap"
									>{formatDateTime(bid.placed_at)}</Table.Cell
								>
								<Table.Cell>
									{#if bid.voided_at}
										<Badge variant="flag">Voided</Badge>
										{#if bid.void_reason}
											<p class="mt-1 text-xs text-ink/60">{bid.void_reason}</p>
										{/if}
									{:else}
										<Badge variant="fairway">Active</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if !bid.voided_at}
										<Button variant="destructive" size="sm" onclick={() => openVoidDialog(bid)}>
											Void
										</Button>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		{/if}
	</div>
</div>

{#if voidTarget}
	<VoidBidDialog
		bind:open={voidDialogOpen}
		{supabase}
		bidId={voidTarget.id}
		playerName={formatPlayerName(voidTarget.player)}
		amount={voidTarget.amount}
		onSuccess={() => invalidateAll()}
	/>
{/if}
