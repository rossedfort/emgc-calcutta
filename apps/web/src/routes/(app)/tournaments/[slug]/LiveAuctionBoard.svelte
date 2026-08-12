<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type {
		Database,
		ErrorResponse,
		PlaceBidRequest,
		PlaceBidResponse,
		RealtimeBid,
		RealtimeLiveLot
	} from '@emgc-calcutta/shared-types';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import SlotMachineDigit from '$lib/components/SlotMachineDigit.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { currencyChars, currentHighBid } from '$lib/bids';
	import { formatHandicapIndex, formatPlayerName } from '$lib/players';
	import { routes } from '$lib/routes';
	import type { FieldPlayerRow } from './+page.server';

	let {
		tournament,
		players,
		liveBids,
		bidsReady,
		liveLots,
		currentUserId,
		supabase,
		now
	}: {
		tournament: { slug: string; min_increment: number; minimum_bid: number };
		players: FieldPlayerRow[];
		liveBids: RealtimeBid[];
		bidsReady: boolean;
		liveLots: RealtimeLiveLot[];
		currentUserId: string;
		supabase: SupabaseClient<Database>;
		now: Date;
	} = $props();

	// Same "don't spin in on first paint" guard SilentAuctionBoard uses —
	// only true once the Realtime store's initial snapshot has landed, so a
	// lot that already has a bid when this page loads just shows the amount
	// immediately instead of animating up from 0.
	let pastInitialLoad = $state(false);
	$effect(() => {
		if (bidsReady) pastInitialLoad = true;
	});

	// At most one lot should ever be opened-but-not-closed at a time — an
	// application-level invariant the Admin's open/close controls are
	// responsible for maintaining, not something enforced here.
	let currentLot = $derived(
		liveLots.find((lot) => lot.opened_at !== null && lot.closed_at === null) ?? null
	);
	let currentPlayer = $derived(
		currentLot ? (players.find((p) => p.id === currentLot!.entry_id) ?? null) : null
	);
	let isCurrentPlayerYou = $derived(currentPlayer?.user_id === currentUserId);

	// Phase 20: who's actually pooled into this lot, if it's a field lot —
	// bidders need to know before they bid, not just after winning.
	// Derived from the same tournament-wide players list every board
	// already has, no extra query.
	function pooledPlayers(fieldEntryId: string): FieldPlayerRow[] {
		return players.filter((p) => p.field_entry_id === fieldEntryId);
	}
	let currentLotHigh = $derived(currentLot ? currentHighBid(liveBids, currentLot.entry_id) : null);

	// The carousel strip below the current lot — every not-yet-opened lot, in
	// queue order, so participants can see what's coming while the current
	// player is being bid on. Skips a lot whose entry can't be found the
	// same way the queue admin screen does (can't happen today, entry_id has
	// no ON DELETE cascade — cheap insurance against a future inconsistency).
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

	// No bid yet on this lot (e.g. a field lot's very first bid): the floor
	// is the tournament's minimum opening bid (place-bid's own `!highBid`
	// branch, Phase 21), not min_increment — increment only governs beating
	// an *existing* high bid.
	function suggestedBid(): number {
		return currentLotHigh
			? currentLotHigh.amount + tournament.min_increment
			: tournament.minimum_bid;
	}

	// The underlying <input type="number"> binds its value as a number (or
	// '' when empty), not a string — see the silent board for the same note.
	let bidAmount = $state<string | number>('');
	let bidPending = $state(false);
	let bidError = $state('');

	async function placeBid() {
		if (!currentPlayer) return;
		const raw = bidAmount;
		const amount = raw === undefined || raw === '' ? suggestedBid() : Number(raw);
		if (!Number.isFinite(amount) || amount <= 0) {
			bidError = 'Enter a valid bid amount';
			return;
		}

		bidPending = true;
		bidError = '';

		const { error: invokeError } = await supabase.functions.invoke<PlaceBidResponse>('place-bid', {
			body: { entryId: currentPlayer.id, amount } satisfies PlaceBidRequest
		});

		bidPending = false;

		if (invokeError) {
			let message = invokeError.message;
			if (invokeError instanceof FunctionsHttpError) {
				const body = (await invokeError.context.json().catch(() => null)) as ErrorResponse | null;
				message = body?.error ?? message;
			}
			bidError = message;
			return;
		}

		bidAmount = '';
	}
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
	{#if !currentLot || !currentPlayer}
		<EmptyState
			title="Waiting for the next lot"
			description="The Admin hasn't opened a player for live bidding yet — check back shortly."
		/>
	{:else}
		<!-- The current lot's own panel — same cream scorecard surface as
		     every other card on this page, sized for normal desktop/mobile
		     reading rather than a TV across the room (see
		     admin/tournaments/[slug]/auction/live/tv for the TV-sized
		     counterpart). Still visually the largest thing on the page —
		     that's what marks it as "the board" against the smaller Up next
		     cards below — just not TV-legible-from-across-the-room large. -->
		<div class="rounded-lg border border-brass/30 bg-scorecard p-4 text-ink sm:p-6">
			<div class="flex items-start justify-between gap-2">
				<div class="flex flex-col gap-1">
					<span class="flex flex-wrap items-center gap-2">
						<a
							href={routes.tournamentPlayer(tournament.slug, currentPlayer.slug)}
							class="font-display text-2xl leading-[1.05] font-semibold break-words text-ink hover:underline sm:text-3xl"
						>
							{formatPlayerName(currentPlayer)}
						</a>
						<DivisionBadge division={currentPlayer.division} />
					</span>
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
				{#if isCurrentPlayerYou}
					<Badge variant="brass">This is you</Badge>
				{/if}
			</div>

			<div
				class="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-brass/40 bg-brass/40"
			>
				<div class="flex flex-col gap-1 bg-scorecard p-3 sm:p-4">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
						Current high
					</span>
					<span
						class="font-data inline-flex text-lg leading-none tracking-tight text-ink tabular-nums sm:text-2xl"
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
				</div>
				<div class="flex flex-col gap-1 bg-scorecard p-3 sm:p-4">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
						Closes in
					</span>
					<span
						class={[
							'font-data text-lg leading-none tracking-tight tabular-nums sm:text-2xl',
							secondsRemaining !== null && secondsRemaining <= 5
								? 'text-flag motion-safe:animate-pulse'
								: 'text-ink'
						]}
					>
						{secondsRemaining !== null ? `${secondsRemaining}s` : '—'}
					</span>
				</div>
			</div>

			<form
				class="mt-4 flex flex-col gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					placeBid();
				}}
			>
				<div class="flex items-center gap-2">
					<Input
						type="number"
						step="0.01"
						min="0.01"
						placeholder={suggestedBid().toFixed(2)}
						bind:value={bidAmount}
						disabled={bidPending}
						class="h-11 text-base"
					/>
					<Button
						type="submit"
						variant="brass"
						disabled={bidPending}
						class="h-11 bg-brass px-6 text-base font-semibold text-ink hover:bg-brass/90"
					>
						{bidPending ? 'Bidding…' : 'Bid'}
					</Button>
				</div>
				{#if bidError}
					<Badge variant="flag" class="w-fit">{bidError}</Badge>
				{/if}
			</form>
		</div>
	{/if}

	{#if upcomingLots.length > 0}
		<div class="flex flex-col gap-2">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">Up next</p>
			<!-- Bounded and scrollable rather than growing the page to fit the
			     whole queue (which could be 100+ players) — all upcoming players
			     are still reachable by scrolling this box, just not all visible
			     at once. Still the standard cream scorecard-card treatment used
			     everywhere else in the app — visually secondary to the one
			     hero panel above, same hierarchy as before. -->
			<div class="max-h-[32rem] overflow-y-auto">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{#each upcomingLots as { lot, player }, index (lot.id)}
						<div class="flex gap-3 rounded-lg border border-brass/30 bg-scorecard p-4 text-ink">
							<span
								class="font-data flex size-6 shrink-0 items-center justify-center rounded-full border border-brass/40 text-xs text-ink/70"
							>
								{index + 1}
							</span>
							<div class="flex items-start justify-between gap-2">
								<div class="flex flex-col gap-1">
									<a
										href={routes.tournamentPlayer(tournament.slug, player.slug)}
										class="font-display text-xl font-semibold text-ink hover:underline"
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
