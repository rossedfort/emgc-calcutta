<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { dragHandle, dragHandleZone } from 'svelte-dnd-action';
	import type {
		RealtimeBid,
		RealtimeLiveLot,
		RealtimePlayerEntry
	} from '@emgc-calcutta/shared-types';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import AdminBidForm from '$lib/components/AdminBidForm.svelte';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { currentHighBid } from '$lib/bids';
	import {
		formatHandicapIndex,
		formatPlayerName,
		playerStatusBadgeVariant,
		playerStatusLabel
	} from '$lib/players';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';

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

	// Phase 32: the reorderable queue list (merged in from the former
	// standalone /auction/queue screen) is a plain server-loaded list,
	// refreshed via each action's own invalidateAll() — not Realtime-driven
	// like the current-lot card above. It's a deliberate management action
	// screen, not something that needs to react to bids landing elsewhere.
	let queuePending = $state<Record<string, boolean>>({});
	let sortPending = $state(false);

	// Phase 38: drag-and-drop reordering. queueItems is a writable $derived
	// (Svelte 5.25+) mirroring data.queue — svelte-dnd-action freely
	// reassigns it mid-drag (via `consider`) and on drop (`finalize`) before
	// persisting, and any direct assignment "sticks" only until data.queue
	// itself changes again (moveUp/moveDown/remove/advance's own
	// invalidateAll(), via use:enhance's default post-success behavior, or
	// this drag's own invalidateAll() below), at which point it recomputes
	// from server truth — exactly the override-then-resync semantics this
	// needs, with no separate effect to keep in sync by hand.
	type QueueItem = (typeof data.queue)[number];
	let queueItems = $derived(data.queue);

	const flipDurationMs = 200;
	let reorderPending = $state(false);
	let reorderError = $state('');

	function handleQueueConsider(e: CustomEvent<{ items: QueueItem[] }>) {
		queueItems = e.detail.items;
	}

	async function handleQueueFinalize(e: CustomEvent<{ items: QueueItem[] }>) {
		queueItems = e.detail.items;
		reorderPending = true;
		reorderError = '';

		// resequence_queue re-validates the given id set against the
		// tournament's current not-yet-opened lots server-side and rejects a
		// stale/tampered order — no separate server action needed, this can
		// go straight from the drop event to the RPC (same direct-client-call
		// pattern AdminBidForm already uses for place-bid).
		const { error: reorderRpcError } = await data.supabase.rpc('resequence_queue', {
			p_tournament_id: data.tournament.id,
			p_ordered_lot_ids: queueItems.map((lot) => lot.id)
		});

		reorderPending = false;

		if (reorderRpcError) {
			reorderError = reorderRpcError.message;
			queueItems = data.queue;
			return;
		}

		await invalidateAll();
	}
</script>

<div class="flex flex-col gap-4 pt-4">
	<Card class="gap-4 rounded-lg border-2 border-brass bg-scorecard p-6 text-ink ring-0">
		<div class="flex items-start justify-between gap-2">
			<div class="flex flex-col gap-1">
				<p class="flex items-center gap-2 font-display text-xl font-semibold text-ink">
					{#if currentPlayer}
						{formatPlayerName(currentPlayer)}
						<DivisionBadge division={currentPlayer.division} />
					{:else}
						No lot open
					{/if}
				</p>
				{#if currentPlayer?.is_field}
					{@const pooled = pooledPlayers(currentPlayer.id)}
					<span class="font-data text-xs tracking-wide text-ink/60 uppercase">
						{currentPlayer.flight ? `Flight ${currentPlayer.flight} · ` : ''}Pooled players:
						{pooled.length > 0 ? pooled.map((p) => formatPlayerName(p)).join(', ') : '—'}
					</span>
				{:else if currentPlayer && (currentPlayer.flight || currentPlayer.handicap_index !== null)}
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
				{:else}
					<span class="font-data text-xs tracking-wide text-ink/60 uppercase">
						Advance the queue below to open the next lot.
					</span>
				{/if}
			</div>
			{#if currentPlayer}
				<Badge variant={playerStatusBadgeVariant(currentPlayer.status)}>
					{playerStatusLabel(currentPlayer.status)}
				</Badge>
			{:else}
				<Badge variant="outline">Idle</Badge>
			{/if}
		</div>

		{#if currentPlayer}
			<div class="flex flex-col gap-3 border-t border-brass/20 pt-4">
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

		<div class="grid grid-cols-2 gap-px overflow-hidden rounded border border-brass/40 bg-brass/40">
			<div class="flex flex-col gap-1 bg-scorecard p-3">
				<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
					Current high
				</span>
				<span class="font-data text-lg text-ink">
					{#if !currentLot}
						—
					{:else if high}
						{formatCurrency(high.amount)}
					{:else}
						No bids yet
					{/if}
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
			bind:this={closeFormEl}
			use:enhance={() => {
				closeSubmitting = true;
				return async ({ update }) => {
					await update();
					closeSubmitting = false;
				};
			}}
		>
			<input type="hidden" name="lotId" value={currentLot?.id ?? ''} />
			<Button type="submit" variant="destructive" disabled={!currentLot || closeSubmitting}>
				{!currentLot
					? 'No lot open'
					: closeSubmitting
						? 'Closing…'
						: high
							? `Close lot — sell to ${formatCurrency(high.amount)}`
							: 'Close lot — no bid'}
			</Button>
		</form>
	</Card>

	<RealtimeStatusBanner status={connectionStatus} />

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	<div class="flex flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">Queue</p>
			{#if queueItems.length > 1}
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

		{#if reorderError}
			<p class="text-sm text-destructive">{reorderError}</p>
		{/if}

		{#if queueItems.length === 0}
			<EmptyState
				title="Nothing queued"
				description="Players are added automatically as they cross the reserve threshold during the silent auction."
			/>
		{:else}
			<div
				class="flex flex-col gap-3"
				use:dragHandleZone={{ items: queueItems, flipDurationMs, dragDisabled: reorderPending }}
				onconsider={handleQueueConsider}
				onfinalize={handleQueueFinalize}
			>
				{#each queueItems as lot, index (lot.id)}
					<Card
						class="flex-row items-stretch gap-0 overflow-hidden rounded-lg border-brass/30 bg-scorecard p-0 text-ink ring-0"
					>
						<div
							use:dragHandle
							aria-label="Reorder {formatPlayerName(lot.player)} in the queue"
							class="flex w-11 shrink-0 touch-none flex-col items-center justify-center gap-1.5 border-r border-brass/30 bg-sand/30 py-3 text-ink/50 select-none active:cursor-grabbing"
						>
							<GripVerticalIcon class="size-4" />
							<span class="font-data text-xs">{String(index + 1).padStart(2, '0')}</span>
						</div>
						<div class="flex flex-1 flex-wrap items-center justify-between gap-3 p-4">
							<div class="flex flex-col gap-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-display text-lg font-semibold text-ink">
										{formatPlayerName(lot.player)}
									</span>
									<DivisionBadge division={lot.player.division} />
									{#if lot.player.is_field}
										<Badge variant="brass">Field lot</Badge>
									{/if}
								</div>
								<span class="font-data text-xs tracking-wide text-ink/60 uppercase">
									{lot.player.flight ? `Flight ${lot.player.flight}` : 'No flight'} · HCP {formatHandicapIndex(
										lot.player.handicap_index
									)}
								</span>
							</div>
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
										<ChevronUpIcon class="size-4" />
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
										disabled={index === queueItems.length - 1 || queuePending[lot.id]}
										aria-label="Move {formatPlayerName(lot.player)} down"
									>
										<ChevronDownIcon class="size-4" />
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
								{#if index === 0}
									<form
										method="POST"
										action="?/advance"
										use:enhance={() => {
											advanceSubmitting = true;
											return async ({ update }) => {
												await update();
												advanceSubmitting = false;
											};
										}}
									>
										<input type="hidden" name="lotId" value={lot.id} />
										<Button
											type="submit"
											variant="brass"
											size="sm"
											disabled={!!currentLot || advanceSubmitting}
										>
											{advanceSubmitting ? 'Opening…' : 'Advance'}
										</Button>
									</form>
								{/if}
							</div>
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	</div>
</div>
