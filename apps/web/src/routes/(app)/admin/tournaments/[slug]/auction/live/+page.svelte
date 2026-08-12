<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import type {
		RealtimeBid,
		RealtimeLiveLot,
		RealtimePlayerEntry
	} from '@emgc-calcutta/shared-types';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Info } from '@lucide/svelte';
	import AdminBidForm from '$lib/components/AdminBidForm.svelte';
	import CursorPager from '$lib/components/CursorPager.svelte';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import VoidBidDialog from '$lib/components/VoidBidDialog.svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import * as Tooltip from '$lib/components/ui/tooltip/index';
	import { currentHighBid } from '$lib/bids';
	import {
		formatHandicapIndex,
		formatPlayerName,
		playerStatusBadgeVariant,
		playerStatusLabel
	} from '$lib/players';
	import { routes } from '$lib/routes';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';
	import type { LiveAuctionBidRow, LiveLotState } from './+page.server';

	let { data, form } = $props();

	let errorMessage = $derived(form && 'error' in form ? (form.error as string) : null);

	let liveBids = $state<RealtimeBid[]>([]);
	let liveEntries = $state<RealtimePlayerEntry[]>([]);
	let liveLots = $state<RealtimeLiveLot[]>([]);
	let connectionStatus = $state<RealtimeConnectionStatus>('connecting');
	let now = $state(new Date());

	onMount(() => {
		const rt = createTournamentRealtime(data.supabase, data.tournament.id);
		const unsubBids = rt.bids.subscribe((bids) => (liveBids = bids));
		const unsubEntries = rt.entries.subscribe((entries) => (liveEntries = entries));
		const unsubLots = rt.liveLots.subscribe((lots) => (liveLots = lots));
		const unsubConnection = rt.connectionStatus.subscribe((s) => (connectionStatus = s));
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => {
			unsubBids();
			unsubEntries();
			unsubLots();
			unsubConnection();
			rt.destroy();
			clearInterval(tick);
		};
	});

	let players = $derived(
		data.players.map((player) => {
			const live = liveEntries.find((e) => e.id === player.id);
			return live ? { ...player, status: live.status as typeof player.status } : player;
		})
	);

	let currentLot = $derived(
		liveLots.find((lot) => lot.opened_at !== null && lot.closed_at === null) ?? null
	);
	let currentPlayer = $derived(
		currentLot ? (players.find((p) => p.id === currentLot!.entry_id) ?? null) : null
	);
	let high = $derived(currentLot ? currentHighBid(liveBids, currentLot.entry_id) : null);

	// Phase 20: the auctioneer needs to know who's pooled into a field lot
	// just as much as bidders do, before calling it live — same derivation
	// the participant board uses, off the same tournament-wide players list.
	function pooledPlayers(fieldEntryId: string) {
		return players.filter((p) => p.field_entry_id === fieldEntryId);
	}

	let nextQueuedLot = $derived(
		liveLots
			.filter((lot) => lot.opened_at === null)
			.sort((a, b) => a.queue_position - b.queue_position)[0] ?? null
	);
	let nextQueuedPlayer = $derived(
		nextQueuedLot ? (players.find((p) => p.id === nextQueuedLot!.entry_id) ?? null) : null
	);

	let secondsRemaining = $derived.by(() => {
		if (!currentLot?.closes_at) return null;
		const ms = new Date(currentLot.closes_at).getTime() - now.getTime();
		return ms > 0 ? Math.ceil(ms / 1000) : 0;
	});

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let advanceSubmitting = $state(false);
	let closeSubmitting = $state(false);
	let closeFormEl = $state<HTMLFormElement | undefined>();

	// Auto-close at zero (Phase 18): fires the same ?/close action the
	// manual button uses, once per lot — autoClosedLotId guards against
	// re-firing every subsequent tick while secondsRemaining sits at 0
	// waiting for the submit to land. Naturally skips a lot Realtime has
	// already closed out from under the timer (e.g. a second admin tab),
	// since currentLot/secondsRemaining go null the moment that update
	// arrives, before this effect's condition can hold.
	let autoClosedLotId = $state<string | null>(null);
	$effect(() => {
		if (
			currentLot &&
			secondsRemaining === 0 &&
			!closeSubmitting &&
			autoClosedLotId !== currentLot.id
		) {
			autoClosedLotId = currentLot.id;
			closeFormEl?.requestSubmit();
		}
	});

	// Phase 32: the reorderable queue table (merged in from the former
	// standalone /auction/queue screen) is a plain server-loaded list,
	// refreshed via each action's own invalidateAll() — not Realtime-driven
	// like the current-lot card above. It's a deliberate management action
	// screen, not something that needs to react to bids landing elsewhere.
	let queuePending = $state<Record<string, boolean>>({});
	let sortPending = $state(false);

	// Phase 36: "Recent live auction bids" review/void table — a plain
	// page-load snapshot refreshed via invalidateAll() after a void, same
	// as the silent auction admin page's own bid review table (not
	// Realtime-driven like the current-lot card above; this is a screen an
	// Admin opens to audit/correct bids, not one watched live).
	let bidIsQuerying = $derived(navigating.to?.route.id === page.route.id);
	let bidFiltersActive = $derived(
		Boolean(data.liveBidFilters.player || data.liveBidFilters.bidder)
	);

	function bidPageUrl(params: Record<string, string | null>): string {
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

	let bidNextHref = $derived(
		data.liveBidsHasNext ? bidPageUrl({ cursor: data.liveBidsNextCursor, dir: 'before' }) : null
	);
	let bidPrevHref = $derived(
		data.liveBidsHasPrev ? bidPageUrl({ cursor: data.liveBidsPrevCursor, dir: 'after' }) : null
	);

	function changeBidPageSize(size: string) {
		goto(bidPageUrl({ page_size: size, cursor: null, dir: null }));
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

	const bidDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function formatBidDateTime(iso: string): string {
		return bidDateTimeFormatter.format(new Date(iso));
	}

	let voidDialogOpen = $state(false);
	let voidTarget = $state<LiveAuctionBidRow | null>(null);

	function openVoidDialog(bid: LiveAuctionBidRow) {
		voidTarget = bid;
		voidDialogOpen = true;
	}
</script>

<div class="flex flex-col gap-4 pt-4">
	<div class="flex justify-end">
		<Button
			href={routes.adminTournamentAuctionLiveTV(data.tournament.slug)}
			target="_blank"
			variant="outline"
			size="sm"
		>
			<ExternalLinkIcon class="size-4" />
			TV Display
		</Button>
	</div>

	{#if currentLot && currentPlayer}
		<div class="flex flex-col gap-3 rounded-lg border border-brass/30 p-6 text-ink">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">Place a bid</p>
			<AdminBidForm
				supabase={data.supabase}
				tournament={data.tournament}
				participants={data.participants}
				entryId={currentPlayer.id}
				entryLabel={formatPlayerName(currentPlayer)}
				highBid={high}
			/>
		</div>
	{/if}

	<RealtimeStatusBanner status={connectionStatus} />

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	{#if currentLot && currentPlayer}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
			<div class="flex items-start justify-between gap-2">
				<div class="flex flex-col gap-1">
					<p class="flex items-center gap-2 font-display text-xl font-semibold text-ink">
						{formatPlayerName(currentPlayer)}
						<DivisionBadge division={currentPlayer.division} />
					</p>
					{#if currentPlayer.is_field}
						{@const pooled = pooledPlayers(currentPlayer.id)}
						<span class="font-data text-xs tracking-wide text-ink/60 uppercase">
							{currentPlayer.flight ? `Flight ${currentPlayer.flight} · ` : ''}Pooled players:
							{pooled.length > 0 ? pooled.map((p) => formatPlayerName(p)).join(', ') : '—'}
						</span>
					{:else if currentPlayer.flight || currentPlayer.handicap_index !== null}
						<span class="font-data text-xs tracking-wide text-ink/60 uppercase">
							{[
								currentPlayer.flight ? `Flight ${currentPlayer.flight}` : null,
								currentPlayer.handicap_index !== null
									? `HCP ${formatHandicapIndex(currentPlayer.handicap_index)}`
									: null
							]
								.filter(Boolean)
								.join(' · ')}
						</span>
					{/if}
				</div>
				<Badge variant={playerStatusBadgeVariant(currentPlayer.status)}>
					{playerStatusLabel(currentPlayer.status)}
				</Badge>
			</div>

			<div
				class="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-brass/40 bg-brass/40"
			>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
						Current high
					</span>
					<span class="font-data text-lg text-ink">
						{high ? formatCurrency(high.amount) : 'No bids yet'}
					</span>
					{#if high?.placed_by_admin_id}
						<Badge variant="sand" class="w-fit">Admin-placed</Badge>
					{/if}
				</div>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
						Closes in
					</span>
					<span class="font-data text-lg text-ink">
						{secondsRemaining !== null ? `${secondsRemaining}s` : '—'}
					</span>
				</div>
			</div>

			<form
				method="POST"
				action="?/close"
				class="mt-4"
				bind:this={closeFormEl}
				use:enhance={() => {
					closeSubmitting = true;
					return async ({ update }) => {
						await update();
						closeSubmitting = false;
					};
				}}
			>
				<input type="hidden" name="lotId" value={currentLot.id} />
				<Button type="submit" variant="destructive" disabled={closeSubmitting}>
					{closeSubmitting
						? 'Closing…'
						: high
							? `Close lot — sell to ${formatCurrency(high.amount)}`
							: 'Close lot — no bid'}
				</Button>
			</form>
		</div>
	{:else if nextQueuedLot && nextQueuedPlayer}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">Up next</p>
			<p class="mt-1 flex items-center gap-2 font-display text-xl font-semibold text-ink">
				{formatPlayerName(nextQueuedPlayer)}
				<DivisionBadge division={nextQueuedPlayer.division} />
			</p>
			{#if nextQueuedPlayer.is_field}
				{@const pooled = pooledPlayers(nextQueuedPlayer.id)}
				<p class="font-data text-xs tracking-wide text-ink/60 uppercase">
					Pooled players: {pooled.length > 0
						? pooled.map((p) => formatPlayerName(p)).join(', ')
						: '—'}
				</p>
			{/if}
			<form
				method="POST"
				action="?/advance"
				class="mt-4"
				use:enhance={() => {
					advanceSubmitting = true;
					return async ({ update }) => {
						await update();
						advanceSubmitting = false;
					};
				}}
			>
				<input type="hidden" name="lotId" value={nextQueuedLot.id} />
				<Button type="submit" variant="brass" disabled={advanceSubmitting}>
					{advanceSubmitting ? 'Opening…' : `Advance to ${formatPlayerName(nextQueuedPlayer)}`}
				</Button>
			</form>
		</div>
	{:else}
		<EmptyState
			title="Queue is empty"
			description="Reserved players are added to the queue automatically as they cross the reserve threshold during the silent auction."
		/>
	{/if}

	<div class="flex flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">Upcoming queue</p>
			{#if data.queue.length > 1}
				<div class="flex items-center gap-2">
					<span class="text-xs text-ink/60">Sort:</span>
					<form
						method="POST"
						action="?/sortHandicapAsc"
						use:enhance={() => {
							sortPending = true;
							return async ({ update }) => {
								await update();
								sortPending = false;
							};
						}}
					>
						<Button type="submit" variant="outline" size="sm" disabled={sortPending}>
							Handicap ascending
						</Button>
					</form>
					<form
						method="POST"
						action="?/sortHandicapDesc"
						use:enhance={() => {
							sortPending = true;
							return async ({ update }) => {
								await update();
								sortPending = false;
							};
						}}
					>
						<Button type="submit" variant="outline" size="sm" disabled={sortPending}>
							Handicap descending
						</Button>
					</form>
					<form
						method="POST"
						action="?/sortShuffle"
						use:enhance={() => {
							sortPending = true;
							return async ({ update }) => {
								await update();
								sortPending = false;
							};
						}}
					>
						<Button type="submit" variant="outline" size="sm" disabled={sortPending}>
							Shuffle
						</Button>
					</form>
				</div>
			{/if}
		</div>
		{#if data.queue.length === 0}
			<EmptyState
				title="Nothing queued"
				description="Players are added automatically as they cross the reserve threshold during the silent auction."
			/>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-12">#</Table.Head>
						<Table.Head>Name</Table.Head>
						<Table.Head>Flight</Table.Head>
						<Table.Head>Handicap</Table.Head>
						<Table.Head>Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.queue as lot, index (lot.id)}
						<Table.Row>
							<Table.Cell class="font-data text-ink/60">{index + 1}</Table.Cell>
							<Table.Cell class="font-medium text-ink">
								{formatPlayerName(lot.player)}
								<DivisionBadge division={lot.player.division} />
								{#if lot.player.is_field}
									<Badge variant="brass">Field lot</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell>{lot.player.flight || '—'}</Table.Cell>
							<Table.Cell class="font-data"
								>{formatHandicapIndex(lot.player.handicap_index)}</Table.Cell
							>
							<Table.Cell>
								<div class="flex items-center gap-1">
									<form
										method="POST"
										action="?/moveUp"
										use:enhance={() => {
											queuePending[lot.id] = true;
											return async ({ update }) => {
												await update();
												queuePending[lot.id] = false;
											};
										}}
									>
										<input type="hidden" name="lotId" value={lot.id} />
										<Button
											type="submit"
											variant="outline"
											size="icon-sm"
											disabled={index === 0 || queuePending[lot.id]}
											aria-label="Move {formatPlayerName(lot.player)} up"
										>
											↑
										</Button>
									</form>
									<form
										method="POST"
										action="?/moveDown"
										use:enhance={() => {
											queuePending[lot.id] = true;
											return async ({ update }) => {
												await update();
												queuePending[lot.id] = false;
											};
										}}
									>
										<input type="hidden" name="lotId" value={lot.id} />
										<Button
											type="submit"
											variant="outline"
											size="icon-sm"
											disabled={index === data.queue.length - 1 || queuePending[lot.id]}
											aria-label="Move {formatPlayerName(lot.player)} down"
										>
											↓
										</Button>
									</form>
									<form
										method="POST"
										action="?/remove"
										use:enhance={() => {
											queuePending[lot.id] = true;
											return async ({ update }) => {
												await update();
												queuePending[lot.id] = false;
											};
										}}
									>
										<input type="hidden" name="lotId" value={lot.id} />
										<Button
											type="submit"
											variant="destructive"
											size="sm"
											disabled={queuePending[lot.id]}
										>
											Remove
										</Button>
									</form>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	<div class="flex flex-col gap-2">
		<h2 class="font-display text-lg font-semibold text-ink">Recent live auction bids</h2>
		<p class="text-sm text-ink/60">
			Bids placed during the live auction, newest first. Voiding a closed lot's winning bid
			recomputes the winner immediately.
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
					value={data.liveBidFilters.player}
					placeholder="Name"
					disabled={bidIsQuerying}
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-muted-foreground">Bidder</span>
				<Input
					type="text"
					name="bidder"
					value={data.liveBidFilters.bidder}
					placeholder="Name"
					disabled={bidIsQuerying}
				/>
			</label>
			<input type="hidden" name="page_size" value={data.liveBidPageSize} />
			<Button type="submit" variant="brass" size="sm" disabled={bidIsQuerying}>
				{#if bidIsQuerying}
					<LoaderCircleIcon class="size-3.5 animate-spin" />
				{/if}
				{bidIsQuerying ? 'Applying…' : 'Apply filters'}
			</Button>
			{#if bidFiltersActive}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={bidIsQuerying}
					onclick={() => goto(routes.adminTournamentAuctionLive(data.tournament.slug))}
				>
					Clear
				</Button>
			{/if}
		</form>

		{#if data.liveBids.length === 0}
			<EmptyState
				title={bidFiltersActive ? 'No bids match these filters' : 'No live auction bids yet'}
			/>
		{:else}
			<Table.Root class={bidIsQuerying ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
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
					{#each data.liveBids as bid (bid.id)}
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
							<Table.Cell class="font-data whitespace-nowrap"
								>{formatCurrency(bid.amount)}</Table.Cell
							>
							<Table.Cell class="font-data whitespace-nowrap"
								>{formatBidDateTime(bid.placed_at)}</Table.Cell
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
				pageSize={data.liveBidPageSize}
				hasNext={data.liveBidsHasNext}
				hasPrev={data.liveBidsHasPrev}
				nextHref={bidNextHref}
				prevHref={bidPrevHref}
				disabled={bidIsQuerying}
				onPageSizeChange={changeBidPageSize}
			/>
		{/if}
	</div>
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
