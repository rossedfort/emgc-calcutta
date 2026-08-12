<script lang="ts">
	import { flip } from 'svelte/animate';
	import type { RealtimeBid } from '@emgc-calcutta/shared-types';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { formatHandicapIndex, formatPlayerName } from '$lib/players';
	import type { FieldPlayerRow } from './+page.server';

	// A live-updating feed of incoming silent-auction bids, most recent on
	// top — a different shape from LiveAuctionTVBoard's single current-lot
	// hero, since many players are being bid on at once during the silent
	// phase rather than one lot at a time. Passive display only, same as the
	// live-auction TV board: no bid form.
	let {
		tournament,
		players,
		liveBids,
		bidsReady
	}: {
		tournament: { bid_anonymity_enabled: boolean };
		players: FieldPlayerRow[];
		liveBids: RealtimeBid[];
		bidsReady: boolean;
	} = $props();

	// Bounded rather than growing for the whole silent-auction window — this
	// is a glanceable ambient display, not something anyone scrolls, so
	// older rows just fall off the bottom as new ones arrive instead of the
	// page growing indefinitely.
	const MAX_ROWS = 15;

	let recentBids = $derived(
		liveBids
			.filter((bid) => bid.phase === 'silent' && !bid.voided_at)
			.sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime())
			.slice(0, MAX_ROWS)
			.flatMap((bid) => {
				const player = players.find((p) => p.id === bid.entry_id);
				return player ? [{ bid, player }] : [];
			})
	);

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-3 p-8">
	{#if !bidsReady}
		<Skeleton class="h-24 w-full" />
		<Skeleton class="h-24 w-full" />
		<Skeleton class="h-24 w-full" />
	{:else if recentBids.length === 0}
		<EmptyState
			title="Waiting for the first bid"
			description="Bids will appear here as they're placed during the silent auction."
		/>
	{:else}
		{#each recentBids as { bid, player } (bid.id)}
			<div
				animate:flip={{ duration: 300 }}
				class="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-brass/30 bg-scorecard px-6 py-4 text-ink"
			>
				<div class="flex min-w-0 flex-1 items-center gap-3">
					<span class="font-display text-2xl font-semibold break-words xl:text-3xl">
						{formatPlayerName(player)}
					</span>
					<DivisionBadge division={player.division} size="lg" />
				</div>
				<div class="flex flex-col items-end gap-0.5">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">HCP</span>
					<span class="font-data text-lg xl:text-xl">
						{formatHandicapIndex(player.handicap_index)}
					</span>
				</div>
				<div class="flex flex-col items-end gap-0.5">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Flight</span>
					<span class="font-data text-lg xl:text-xl">{player.flight || '—'}</span>
				</div>
				{#if !tournament.bid_anonymity_enabled}
					<div class="flex flex-col items-end gap-0.5">
						<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
							Bidder
						</span>
						<span class="font-data text-lg xl:text-xl">{bid.bidder_name ?? '—'}</span>
					</div>
				{/if}
				<div class="flex flex-col items-end gap-0.5">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Bid</span>
					<span class="font-data text-2xl font-bold text-ink tabular-nums xl:text-3xl">
						{formatCurrency(bid.amount)}
					</span>
				</div>
			</div>
		{/each}
	{/if}
</div>
