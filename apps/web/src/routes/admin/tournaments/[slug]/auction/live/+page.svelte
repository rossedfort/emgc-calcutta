<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type {
		RealtimeBid,
		RealtimeLiveLot,
		RealtimePlayerEntry
	} from '@emgc-calcutta/shared-types';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
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
</script>

<div class="flex flex-col gap-4 pt-4">
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
					{#if currentPlayer.flight || currentPlayer.handicap_index !== null}
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
			description="Add reserved players to the queue before starting the live auction."
		/>
	{/if}
</div>
