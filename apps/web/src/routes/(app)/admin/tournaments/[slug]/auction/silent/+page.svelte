<script lang="ts">
	import { onMount } from 'svelte';
	import { navigating, page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import type { RealtimeBid, RealtimePlayerEntry } from '@emgc-calcutta/shared-types';
	import AdminBidForm from '$lib/components/AdminBidForm.svelte';
	import Combobox from '$lib/components/Combobox.svelte';
	import CursorPager from '$lib/components/CursorPager.svelte';
	import TableHeaderTextFilter from '$lib/components/TableHeaderTextFilter.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index';
	import { Info } from '@lucide/svelte';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import VoidBidDialog from '$lib/components/VoidBidDialog.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { currentHighBid } from '$lib/bids';
	import { formatPlayerName } from '$lib/players';
	import { routes } from '$lib/routes';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';
	import type { SilentAuctionBidRow } from './+page.server';

	let { data } = $props();
	let { supabase, tournament, bids } = $derived(data);

	let liveBids = $state<RealtimeBid[]>([]);
	let liveEntries = $state<RealtimePlayerEntry[]>([]);
	let connectionStatus = $state<RealtimeConnectionStatus>('connecting');

	onMount(() => {
		const rt = createTournamentRealtime(
			supabase,
			tournament.id,
			data.entries.map((e) => e.id)
		);
		const unsubBids = rt.bids.subscribe((b) => (liveBids = b));
		const unsubEntries = rt.entries.subscribe((e) => (liveEntries = e));
		const unsubConnection = rt.connectionStatus.subscribe((s) => (connectionStatus = s));
		return () => {
			unsubBids();
			unsubEntries();
			unsubConnection();
			rt.destroy();
		};
	});

	// Phase 32: the admin-on-behalf-of-participant bid panel needs to know
	// which entries are currently open (many are, during silent phase) and
	// each one's current high bid — both live-updated the same way the
	// merged live auction screen's own player list is, so an entry crossing
	// the threshold elsewhere drops out of this search without a reload.
	let currentEntries = $derived(
		data.entries.map((entry) => {
			const live = liveEntries.find((e) => e.id === entry.id);
			return live ? { ...entry, status: live.status } : entry;
		})
	);
	let openEntries = $derived(currentEntries.filter((entry) => entry.status === 'open'));
	let entryOptions = $derived(
		openEntries.map((entry) => ({
			value: entry.id,
			label: formatPlayerName(entry),
			description:
				[
					entry.flight ? `Flight ${entry.flight}` : null,
					entry.division !== 'overall' ? entry.division : null
				]
					.filter(Boolean)
					.join(' · ') || undefined
		}))
	);

	let bidEntryId = $state<string | null>(null);
	let selectedEntry = $derived(currentEntries.find((e) => e.id === bidEntryId) ?? null);
	let selectedEntryHigh = $derived(bidEntryId ? currentHighBid(liveBids, bidEntryId) : null);

	// Matches the [slug]/+layout.svelte's own silentAuctionEnded check —
	// once the deadline passes, close_silent_auctions() (pg_cron) sweeps
	// every open entry to sold_silent/no_bid within a minute, so placing a
	// bid here would just fail entryStatus validation in place-bid. Hiding
	// the form instead of leaving it up to error out keeps this consistent
	// with the rest of the app's "phase-aware" admin screens.
	let silentAuctionEnded = $derived(new Date(tournament.silent_auction_end) <= new Date());

	// The filter form is a plain GET, so re-querying is a real SvelteKit
	// navigation (re-running this route's server `load`) rather than a
	// fetch this component kicks off itself — `navigating` is the only
	// signal available for it. Scoped to "navigating to this same route"
	// so the indicator doesn't flash while leaving the page entirely.
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

	// Phase 37: each column's own header filter applies independently via
	// its own popover (Apply/Clear), not one shared "Apply filters" button
	// — every apply is a real navigation, resetting pagination back to
	// page 1 since the result set's boundaries just changed.
	function applyFilter(updates: Record<string, string | null>) {
		goto(pageUrl({ ...updates, cursor: null, dir: null }));
	}

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
	<div class="flex flex-col gap-3 rounded-lg border border-brass/30 p-6 text-ink">
		<p class="font-data text-xs tracking-widest text-fairway uppercase">Place a bid</p>
		{#if silentAuctionEnded}
			<p class="text-sm text-ink/70">
				The silent auction has closed — bids can no longer be placed on behalf of participants.
			</p>
		{:else}
			<p class="text-sm text-ink/70">
				The minimum opening bid is {formatCurrency(tournament.minimum_bid)}. Bids of {formatCurrency(
					tournament.threshold_amount
				)} or more reserve a player for the live auction — each new bid must beat the current high by
				at least {formatCurrency(tournament.min_increment)}.
			</p>
			<div class="flex flex-col gap-1">
				<span class="font-data text-xs tracking-widest text-fairway uppercase">Player</span>
				<Combobox
					options={entryOptions}
					bind:value={bidEntryId}
					placeholder="Search by name…"
					emptyText="No open players found."
				/>
			</div>
			<AdminBidForm
				{supabase}
				{tournament}
				participants={data.participants}
				entryId={bidEntryId}
				entryLabel={selectedEntry ? formatPlayerName(selectedEntry) : null}
				highBid={selectedEntryHigh}
				onSuccess={() => invalidateAll()}
			/>
		{/if}
	</div>

	<RealtimeStatusBanner status={connectionStatus} />

	<div class="flex flex-col gap-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex flex-col gap-1">
				<h2 class="font-display text-lg font-semibold text-ink">Recent silent auction bids</h2>
				<p class="text-sm text-ink/60">Bids placed during the silent auction, newest first.</p>
			</div>
			{#if filtersActive}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={isQuerying}
					onclick={() => goto(routes.adminTournamentAuctionSilent(tournament.slug))}
				>
					Clear filters
				</Button>
			{/if}
		</div>

		{#if bids.length === 0}
			<EmptyState
				title={filtersActive ? 'No bids match these filters' : 'No silent auction bids yet'}
			/>
		{:else}
			<Table.Root class={isQuerying ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
				<Table.Header>
					<Table.Row>
						<Table.Head>
							<span class="inline-flex items-center gap-1">
								Player
								<TableHeaderTextFilter
									label="Player"
									value={data.filters.player}
									placeholder="Name"
									onApply={(value) => applyFilter({ player: value || null })}
								/>
							</span>
						</Table.Head>
						<Table.Head>
							<span class="inline-flex items-center gap-1">
								Bidder
								<TableHeaderTextFilter
									label="Bidder"
									value={data.filters.bidder}
									placeholder="Name"
									onApply={(value) => applyFilter({ bidder: value || null })}
								/>
							</span>
						</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Placed</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each bids as bid (bid.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">
								<a
									href={routes.tournamentPlayer(tournament.slug, bid.player.slug)}
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
							<Table.Cell class="font-data whitespace-nowrap"
								>{formatCurrency(bid.amount)}</Table.Cell
							>
							<Table.Cell class="font-data whitespace-nowrap"
								>{formatDateTime(bid.placed_at)}</Table.Cell
							>
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
