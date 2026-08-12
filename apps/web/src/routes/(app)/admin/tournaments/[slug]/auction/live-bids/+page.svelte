<script lang="ts">
	import { navigating, page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { Info } from '@lucide/svelte';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CursorPager from '$lib/components/CursorPager.svelte';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import VoidBidDialog from '$lib/components/VoidBidDialog.svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import * as Tooltip from '$lib/components/ui/tooltip/index';
	import { formatPlayerName } from '$lib/players';
	import { routes } from '$lib/routes';
	import type { LiveAuctionBidRow, LiveLotState } from './+page.server';

	let { data } = $props();

	let isQuerying = $derived(navigating.to?.route.id === page.route.id);
	let filtersActive = $derived(Boolean(data.filters.player || data.filters.bidder));

	function pageUrl(params: Record<string, string | null>): string {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(params)) {
			if (value === null) {
				url.searchParams.delete(key);
			} else {
				url.searchParams.set(key, value);
			}
		}
		return `${url.pathname}${url.search}`;
	}

	let nextHref = $derived(
		data.hasNext ? pageUrl({ cursor: data.nextCursor, dir: 'before' }) : null
	);
	let prevHref = $derived(data.hasPrev ? pageUrl({ cursor: data.prevCursor, dir: 'after' }) : null);

	function changePageSize(size: string) {
		goto(pageUrl({ page_size: size, cursor: null, dir: null }));
	}

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function lotStateBadgeVariant(state: LiveLotState): BadgeVariant {
		switch (state) {
			case 'open':
				return 'flag';
			case 'closed':
				return 'fairway';
			default:
				return 'outline';
		}
	}

	function lotStateLabel(state: LiveLotState): string {
		switch (state) {
			case 'open':
				return 'Open now';
			case 'closed':
				return 'Closed';
			default:
				return 'Not yet opened';
		}
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
	let voidTarget = $state<LiveAuctionBidRow | null>(null);

	function openVoidDialog(bid: LiveAuctionBidRow) {
		voidTarget = bid;
		voidDialogOpen = true;
	}
</script>

<div class="flex flex-col gap-2 pt-4">
	<p class="text-sm text-ink/60">
		Bids placed during the live auction, newest first. Voiding a closed lot's winning bid recomputes
		the winner immediately.
	</p>

	<form
		method="GET"
		class="flex flex-wrap items-end gap-3 rounded-lg border border-brass/30 bg-scorecard p-4"
	>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Player</span>
			<Input
				type="text"
				name="player"
				value={data.filters.player}
				placeholder="Name"
				disabled={isQuerying}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Bidder</span>
			<Input
				type="text"
				name="bidder"
				value={data.filters.bidder}
				placeholder="Name"
				disabled={isQuerying}
			/>
		</label>
		<input type="hidden" name="page_size" value={data.pageSize} />
		<Button type="submit" variant="brass" size="sm" disabled={isQuerying}>
			{#if isQuerying}
				<LoaderCircleIcon class="size-3.5 animate-spin" />
			{/if}
			{isQuerying ? 'Applying…' : 'Apply filters'}
		</Button>
		{#if filtersActive}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={isQuerying}
				onclick={() => goto(routes.adminTournamentAuctionLiveBids(data.tournament.slug))}
			>
				Clear
			</Button>
		{/if}
	</form>

	{#if data.bids.length === 0}
		<EmptyState
			title={filtersActive ? 'No bids match these filters' : 'No live auction bids yet'}
		/>
	{:else}
		<Table.Root class={isQuerying ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
			<Table.Header>
				<Table.Row>
					<Table.Head>Player</Table.Head>
					<Table.Head>Bidder</Table.Head>
					<Table.Head>Amount</Table.Head>
					<Table.Head>Placed</Table.Head>
					<Table.Head>Lot</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head>Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.bids as bid (bid.id)}
					<Table.Row>
						<Table.Cell class="font-medium text-ink">
							<a
								href={routes.tournamentPlayer(data.tournament.slug, bid.player.slug)}
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
							{#if bid.placed_by_admin_id}
								<Badge variant="sand" class="ml-1">Admin-placed</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="font-data whitespace-nowrap">{formatCurrency(bid.amount)}</Table.Cell
						>
						<Table.Cell class="font-data whitespace-nowrap"
							>{formatDateTime(bid.placed_at)}</Table.Cell
						>
						<Table.Cell>
							{#if bid.lot_state}
								<Badge variant={lotStateBadgeVariant(bid.lot_state)}>
									{lotStateLabel(bid.lot_state)}
								</Badge>
							{:else}
								<span class="text-muted-foreground">—</span>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{#if bid.voided_at}
								<div class="flex items-center gap-1">
									<Badge variant="flag">Voided</Badge>
									{#if bid.void_reason}
										<Tooltip.Provider>
											<Tooltip.Root>
												<Tooltip.Trigger>
													<Info size="16" />
												</Tooltip.Trigger>
												<Tooltip.Content>
													<p>{bid.void_reason}</p>
												</Tooltip.Content>
											</Tooltip.Root>
										</Tooltip.Provider>
									{/if}
								</div>
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
		<CursorPager
			pageSize={data.pageSize}
			hasNext={data.hasNext}
			hasPrev={data.hasPrev}
			{nextHref}
			{prevHref}
			disabled={isQuerying}
			onPageSizeChange={changePageSize}
		/>
	{/if}
</div>

{#if voidTarget}
	<VoidBidDialog
		bind:open={voidDialogOpen}
		supabase={data.supabase}
		bidId={voidTarget.id}
		playerName={formatPlayerName(voidTarget.player)}
		amount={voidTarget.amount}
		onSuccess={() => invalidateAll()}
	/>
{/if}
