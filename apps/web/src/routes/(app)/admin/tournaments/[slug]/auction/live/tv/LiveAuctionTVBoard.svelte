<script lang="ts">
	import type { RealtimeBid, RealtimeLiveLot } from '@emgc-calcutta/shared-types';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import SlotMachineDigit from '$lib/components/SlotMachineDigit.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { currencyChars, currentHighBid } from '$lib/bids';
	import { formatHandicapIndex, formatPlayerName } from '$lib/players';
	import { routes } from '$lib/routes';
	import type { FieldPlayerRow } from './+page.server';

	// Same content as the participant-facing LiveAuctionBoard (see
	// tournaments/[slug]/LiveAuctionBoard.svelte) minus the bid form — this
	// is a passive display for the room, not a bidding surface, and is
	// TV-sized rather than scaled for normal desktop/mobile viewing.
	// Rendered shell-less (see ../+page@.svelte).
	let {
		tournament,
		players,
		liveBids,
		bidsReady,
		liveLots,
		currentUserId,
		now
	}: {
		tournament: { slug: string; bid_anonymity_enabled: boolean };
		players: FieldPlayerRow[];
		liveBids: RealtimeBid[];
		bidsReady: boolean;
		liveLots: RealtimeLiveLot[];
		currentUserId: string;
		now: Date;
	} = $props();

	// Same "don't spin in on first paint" guard as LiveAuctionBoard/
	// SilentAuctionBoard — only true once the Realtime store's initial
	// snapshot has landed.
	let pastInitialLoad = $state(false);
	$effect(() => {
		if (bidsReady) pastInitialLoad = true;
	});

	let currentLot = $derived(
		liveLots.find((lot) => lot.opened_at !== null && lot.closed_at === null) ?? null
	);
	let currentPlayer = $derived(
		currentLot ? (players.find((p) => p.id === currentLot!.entry_id) ?? null) : null
	);
	let isCurrentPlayerYou = $derived(currentPlayer?.user_id === currentUserId);

	function pooledPlayers(fieldEntryId: string): FieldPlayerRow[] {
		return players.filter((p) => p.field_entry_id === fieldEntryId);
	}
	let currentLotHigh = $derived(currentLot ? currentHighBid(liveBids, currentLot.entry_id) : null);

	let upcomingLots = $derived(
		liveLots
			.filter((lot) => lot.opened_at === null)
			.sort((a, b) => a.queue_position - b.queue_position)
			.flatMap((lot) => {
				const player = players.find((p) => p.id === lot.entry_id);
				return player ? [{ lot, player }] : [];
			})
	);

	let secondsRemaining = $derived.by(() => {
		if (!currentLot?.closes_at) return null;
		const ms = new Date(currentLot.closes_at).getTime() - now.getTime();
		return ms > 0 ? Math.ceil(ms / 1000) : 0;
	});

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}
</script>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8">
	{#if !currentLot || !currentPlayer}
		<EmptyState
			title="Waiting for the next lot"
			description="The Admin hasn't opened a player for live bidding yet — check back shortly."
		/>
	{:else}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-10 text-ink xl:p-12">
			<div class="flex items-start justify-between gap-2">
				<div class="flex flex-col gap-2">
					<span class="flex flex-wrap items-center gap-4">
						<a
							href={routes.tournamentPlayer(tournament.slug, currentPlayer.slug)}
							class="font-display text-5xl leading-[1.05] font-semibold break-words text-ink hover:underline xl:text-6xl 2xl:text-7xl"
						>
							{formatPlayerName(currentPlayer)}
						</a>
						<DivisionBadge division={currentPlayer.division} size="lg" />
					</span>
					{#if currentPlayer.is_field}
						{@const pooled = pooledPlayers(currentPlayer.id)}
						<span class="font-data text-sm tracking-wide text-ink/60 uppercase xl:text-base">
							{currentPlayer.flight ? `Flight ${currentPlayer.flight} · ` : ''}Pooled players:
							{pooled.length > 0 ? pooled.map((p) => formatPlayerName(p)).join(', ') : '—'}
						</span>
					{:else if currentPlayer.flight || currentPlayer.handicap_index !== null}
						<span class="font-data text-sm tracking-wide text-ink/60 uppercase xl:text-base">
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
				{#if isCurrentPlayerYou}
					<Badge variant="brass">This is you</Badge>
				{/if}
			</div>

			<div
				class="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded border border-brass/40 bg-brass/40"
			>
				<div class="flex flex-col gap-2 bg-scorecard p-6 xl:p-8">
					<span class="font-data text-xs tracking-wider text-ink/60 uppercase xl:text-sm">
						Current high
					</span>
					<span
						class="font-data inline-flex text-5xl leading-none tracking-tight text-ink tabular-nums xl:text-6xl 2xl:text-7xl"
					>
						{#if currentLotHigh}
							{#each currencyChars(formatCurrency(currentLotHigh.amount)) as { char, isDigit, key } (key)}
								{#if isDigit}
									<SlotMachineDigit digit={char} delayMs={key * 60} spinIn={pastInitialLoad} />
								{:else}
									<span
										class="inline-block text-center align-bottom"
										style="height: 1.2em; width: 0.62em; line-height: 1.2em;">{char}</span
									>
								{/if}
							{/each}
						{:else}
							No bids yet
						{/if}
					</span>
					{#if currentLotHigh?.bidder_name && !tournament.bid_anonymity_enabled}
						<span class="font-data text-sm text-ink/50 xl:text-base">
							Bid by {currentLotHigh.bidder_name}
						</span>
					{/if}
				</div>
				<div class="flex flex-col gap-2 bg-scorecard p-6 xl:p-8">
					<span class="font-data text-xs tracking-wider text-ink/60 uppercase xl:text-sm">
						Closes in
					</span>
					<span
						class={[
							'font-data text-5xl leading-none tracking-tight tabular-nums xl:text-6xl 2xl:text-7xl',
							secondsRemaining !== null && secondsRemaining <= 5
								? 'text-flag motion-safe:animate-pulse'
								: 'text-ink'
						]}
					>
						{secondsRemaining !== null ? `${secondsRemaining}s` : '—'}
					</span>
				</div>
			</div>
		</div>
	{/if}

	{#if upcomingLots.length > 0}
		<div class="flex flex-col gap-2">
			<p class="font-data text-sm tracking-widest text-fairway uppercase">Up next</p>
			<div class="max-h-[36rem] overflow-y-auto">
				<div class="grid grid-cols-2 gap-6 xl:grid-cols-3">
					{#each upcomingLots as { lot, player }, index (lot.id)}
						<div class="flex gap-4 rounded-lg border border-brass/30 bg-scorecard p-8 text-ink">
							<span
								class="font-data flex size-10 shrink-0 items-center justify-center rounded-full border border-brass/40 text-lg text-ink/70"
							>
								{index + 1}
							</span>
							<div class="flex items-start justify-between gap-2">
								<div class="flex flex-col gap-1">
									<a
										href={routes.tournamentPlayer(tournament.slug, player.slug)}
										class="font-display text-2xl font-semibold text-ink hover:underline xl:text-3xl"
									>
										{formatPlayerName(player)}
									</a>
									{#if player.is_field}
										{@const pooled = pooledPlayers(player.id)}
										<span class="font-data text-xs tracking-wide text-ink/60 uppercase">
											{player.flight ? `Flight ${player.flight} · ` : ''}Pooled:
											{pooled.length > 0 ? pooled.map((p) => formatPlayerName(p)).join(', ') : '—'}
										</span>
									{:else if player.flight || player.handicap_index !== null}
										<span class="font-data text-xs tracking-wide text-ink/60 uppercase">
											{[
												player.flight ? `Flight ${player.flight}` : null,
												player.handicap_index !== null
													? `HCP ${formatHandicapIndex(player.handicap_index)}`
													: null
											]
												.filter(Boolean)
												.join(' · ')}
										</span>
									{/if}
								</div>
								{#if player.user_id === currentUserId}
									<Badge variant="brass">This is you</Badge>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
