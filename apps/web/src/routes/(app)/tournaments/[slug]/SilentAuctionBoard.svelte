<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type {
		Database,
		ErrorResponse,
		PlaceBidRequest,
		PlaceBidResponse,
		RealtimeBid
	} from '@emgc-calcutta/shared-types';
	import StarIcon from '@lucide/svelte/icons/star';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MultiSelectFilter from '$lib/components/MultiSelectFilter.svelte';
	import PlayerListCard from '$lib/components/PlayerListCard.svelte';
	import SlotMachineDigit from '$lib/components/SlotMachineDigit.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Table from '$lib/components/ui/table';
	import { currencyChars, currentHighBid } from '$lib/bids';
	import {
		PLAYER_STATUSES,
		formatHandicapIndex,
		formatPlayerName,
		playerStatusBadgeVariant,
		playerStatusLabel
	} from '$lib/players';
	import { groupPlayersByFlightAndDivision } from '$lib/flightGroups';
	import { routes } from '$lib/routes';
	import type { FieldPlayerRow } from './+page.server';

	let {
		tournament,
		players,
		liveBids,
		bidsReady,
		currentUserId,
		supabase,
		favoriteEntryIds
	}: {
		tournament: {
			slug: string;
			flights: string[];
			championship_flight: string | null;
			threshold_amount: number;
			min_increment: number;
			minimum_bid: number;
			bid_anonymity_enabled: boolean;
		};
		players: FieldPlayerRow[];
		liveBids: RealtimeBid[];
		// False for the brief window before the Realtime store's first
		// reconcile() resolves (see $lib/stores/realtime.ts) — bid-derived UI
		// (current-high column, pot totals) renders a skeleton instead of a
		// misleading "no bids yet"/$0.00 during that gap.
		bidsReady: boolean;
		currentUserId: string;
		supabase: SupabaseClient<Database>;
		// Entry ids (player_entries.id) this Participant has favorited in
		// this tournament (Phase 39) — an SSR snapshot, not Realtime-driven
		// like liveBids; nobody but this user cares when it changes, so
		// there's nothing to subscribe to.
		favoriteEntryIds: string[];
	} = $props();

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	// Stays false until bidsReady's *first* true render has actually
	// committed, then flips once and for all — used so a player's reels
	// only spin in from zero when their first-ever bid arrives live (a real
	// "no bid" -> "has a bid" transition witnessed on an already-open
	// board), not when the page simply loads on a player who already had a
	// bid (that should snap straight to the current value, no animation).
	// Previously this flipped on onMount instead, which fires long before
	// bidsReady ever does — every cell's very first population of an
	// existing bid was therefore (mis)treated as a live "just placed"
	// event and spun in, all at once, right as the loading skeletons
	// cleared (reported directly as page "jitter"). A $effect fixes this
	// because Svelte always runs it *after* the render it reacts to has
	// committed — so the same render that first shows real digits for
	// bidsReady=true still sees the old (false) value here.
	let pastInitialLoad = $state(false);
	$effect(() => {
		if (bidsReady) pastInitialLoad = true;
	});

	let searchQuery = $state('');
	let statusFilters = $state<string[]>([]);
	let flightFilters = $state<string[]>([]);

	// Phase 39: writable $derived (Svelte 5.25+ override-then-resync
	// pattern, same as Phase 38's drag-reorder queueItems) — toggleFavorite
	// below reassigns this directly for optimistic updates, and any
	// reassignment "sticks" until favoriteEntryIds itself changes again
	// (a fresh page load; nothing else in this component invalidates it).
	// SvelteSet rather than a plain Set per eslint-plugin-svelte's
	// prefer-svelte-reactivity rule.
	let favoritedIds = $derived(new SvelteSet(favoriteEntryIds));
	let favoritePending = $state<Record<string, boolean>>({});

	function setFavorited(entryId: string, favorited: boolean) {
		const next = new SvelteSet(favoritedIds);
		if (favorited) {
			next.add(entryId);
		} else {
			next.delete(entryId);
		}
		favoritedIds = next;
	}

	async function toggleFavorite(entryId: string) {
		if (favoritePending[entryId]) return;
		const wasFavorited = favoritedIds.has(entryId);

		favoritePending[entryId] = true;
		setFavorited(entryId, !wasFavorited);

		const { error: favoriteError } = wasFavorited
			? await supabase
					.from('player_favorites')
					.delete()
					.eq('user_id', currentUserId)
					.eq('entry_id', entryId)
			: await supabase
					.from('player_favorites')
					.insert({ user_id: currentUserId, entry_id: entryId });

		favoritePending[entryId] = false;

		if (favoriteError) {
			setFavorited(entryId, wasFavorited);
			toast.error(
				wasFavorited
					? "Couldn't remove favorite — try again."
					: "Couldn't save favorite — try again."
			);
		}
	}

	let statusOptions = $derived(
		PLAYER_STATUSES.map((status) => ({ value: status, label: playerStatusLabel(status) }))
	);
	let flightOptions = $derived(
		tournament.flights.map((flight) => ({ value: flight, label: flight }))
	);

	let filteredPlayers = $derived(
		players.filter((p) => {
			if (statusFilters.length > 0 && !statusFilters.includes(p.status)) return false;
			if (flightFilters.length > 0 && !flightFilters.includes(p.flight)) return false;
			if (
				searchQuery.trim() &&
				!formatPlayerName(p).toLowerCase().includes(searchQuery.trim().toLowerCase())
			) {
				return false;
			}
			return true;
		})
	);

	// Split into (flight, division) sections rather than flight alone — a
	// Championship-flight golfer's Gross and Net rows are two completely
	// independent auction entries (own bids, own "current high"), and
	// sharing one flight section with just an inline badge wasn't a clear
	// enough distinction for a participant actually placing a bid (reported
	// directly). Each section header now reads e.g. "A — Gross"/"A — Net".
	let groupedPlayers = $derived(
		groupPlayersByFlightAndDivision(
			filteredPlayers,
			tournament.flights,
			tournament.championship_flight
		)
	);

	// Pot totals: grouped by the same (flight, division) split as the
	// player-list sections above — a Championship flight's Gross/Net stay
	// two separate pots here too, matching the payout system's own
	// per-(flight, division) pot scoping (computePotByGroup), not a
	// per-flight combination. Computed from the *unfiltered* player list
	// (search/status/flight filters only affect what rows are visible
	// below, not what counts toward the pot) and each player's current
	// high bid — the same live, reactive `liveBids` data the board's own
	// "Current high" column already renders, so this updates in real time
	// as bids land with no extra query. This is a distinct, "pot so far"
	// concept from the payout system's post-sale pot (sum of only
	// winning_bid_id amounts on sold_* entries) — during the silent
	// auction almost nothing is sold yet, so that definition would show
	// $0 the whole time; this instead sums every entry's current
	// highest live bid (0 if none yet), win-or-not-yet-decided.
	let potGroups = $derived(
		groupPlayersByFlightAndDivision(
			players,
			tournament.flights,
			tournament.championship_flight
		).map(({ group, players: groupPlayers }) => ({
			group,
			total: groupPlayers.reduce((sum, p) => sum + (currentHighBid(liveBids, p.id)?.amount ?? 0), 0)
		}))
	);

	let totalPot = $derived(potGroups.reduce((sum, g) => sum + g.total, 0));

	// No bid yet on this entry: the floor is the tournament's minimum opening
	// bid (place-bid's own `!highBid` branch, Phase 21), not min_increment —
	// increment only governs beating an *existing* high bid.
	function suggestedBid(entryId: string): number {
		const high = currentHighBid(liveBids, entryId);
		return high ? high.amount + tournament.min_increment : tournament.minimum_bid;
	}

	// The underlying <input type="number"> binds its value as a number (or
	// '' when empty), not a string, despite `type` being a dynamic prop on
	// the Input wrapper rather than a literal — so this has to accept both.
	let bidAmounts = $state<Record<string, string | number>>({});
	let bidPending = $state<Record<string, boolean>>({});
	let bidErrors = $state<Record<string, string>>({});

	async function placeBid(entryId: string) {
		const raw = bidAmounts[entryId];
		const amount = raw === undefined || raw === '' ? suggestedBid(entryId) : Number(raw);
		if (!Number.isFinite(amount) || amount <= 0) {
			bidErrors[entryId] = 'Enter a valid bid amount';
			return;
		}

		bidPending[entryId] = true;
		bidErrors[entryId] = '';

		const { error: invokeError } = await supabase.functions.invoke<PlaceBidResponse>('place-bid', {
			body: { entryId, amount } satisfies PlaceBidRequest
		});

		bidPending[entryId] = false;

		if (invokeError) {
			// place-bid's actual { error: string } body is on
			// invokeError.context (a Response), not thrown as the message —
			// supabase-js only gives a generic "non-2xx status code" message
			// otherwise.
			let message = invokeError.message;
			if (invokeError instanceof FunctionsHttpError) {
				const body = (await invokeError.context.json().catch(() => null)) as ErrorResponse | null;
				message = body?.error ?? message;
			}
			bidErrors[entryId] = message;
			return;
		}

		bidAmounts[entryId] = '';
	}
</script>

<div class="flex flex-col gap-2">
	<p class="text-sm text-ink/70">
		The minimum opening bid is {formatCurrency(tournament.minimum_bid)}. Bids of {formatCurrency(
			tournament.threshold_amount
		)} or more reserve a player for the live auction — each new bid must beat the current high by at least
		{formatCurrency(tournament.min_increment)}.
	</p>

	{#if potGroups.length > 1}
		<!-- One row per (flight, division) group — the Championship flight's
		     Gross and Net stay two fully separate rows here too (own label,
		     own amount), not merged into one shared row, matching how the
		     player-list sections below already keep them as two independent
		     auction pools rather than one flight with an inline badge (user
		     feedback: an earlier version of this table merged them into a
		     single two-line row, which read as one pot when they're actually
		     two). Rather than one column per flight: with enough flights
		     configured, a wide column-per-flight grid ran off the side of
		     narrower screens instead of just growing taller. The total (shown
		     as its own line above when there's no breakdown table to anchor
		     it to — see the else branch below) lives in this table's own
		     footer row instead, once there's a breakdown to total up. -->
		<!-- table-fixed + an explicit width on the Flight column pins both
		     columns' widths regardless of content — otherwise the browser's
		     default auto table layout re-measures column widths from
		     whatever's actually in the Pot cells, and skeleton placeholders
		     are never exactly as wide as the real dollar amounts that
		     replace them, so the Flight/Pot boundary (and everything in the
		     Pot column) visibly shifted sideways right as bids landed
		     (reported directly, screen recording of the pot table). -->
		<Table.Root class="table-fixed">
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-1/2">Flight</Table.Head>
					<Table.Head>Pot</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each potGroups as { group, total } (`${group.flight}::${group.division}`)}
					<Table.Row>
						<Table.Cell
							class="font-data text-xs tracking-widest text-fairway uppercase whitespace-nowrap"
						>
							{group.label}
						</Table.Cell>
						<Table.Cell class="font-data whitespace-nowrap">
							{#if bidsReady}
								{formatCurrency(total)}
							{:else}
								<Skeleton class="h-5 w-16" />
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
			<Table.Footer>
				<Table.Row>
					<Table.Cell
						class="font-data text-xs font-semibold tracking-widest text-fairway uppercase whitespace-nowrap"
					>
						Total
					</Table.Cell>
					<Table.Cell class="font-data font-semibold text-ink whitespace-nowrap">
						{#if bidsReady}
							{formatCurrency(totalPot)}
						{:else}
							<Skeleton class="h-5 w-24" />
						{/if}
					</Table.Cell>
				</Table.Row>
			</Table.Footer>
		</Table.Root>
	{:else}
		<div class="flex items-baseline justify-between">
			<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Total pot</span>
			{#if bidsReady}
				<span class="font-data text-lg text-ink">{formatCurrency(totalPot)}</span>
			{:else}
				<!-- h-7 matches text-lg's own line-height (1.75rem) so this doesn't
				     change the row's height once the real value swaps in. -->
				<Skeleton class="h-7 w-24" />
			{/if}
		</div>
	{/if}
</div>

<div class="flex flex-wrap items-center gap-4 text-sm">
	<Input type="search" placeholder="Search players…" bind:value={searchQuery} class="max-w-56" />
	<MultiSelectFilter label="Status" options={statusOptions} bind:selected={statusFilters} />
	{#if flightOptions.length > 0}
		<MultiSelectFilter label="Flight" options={flightOptions} bind:selected={flightFilters} />
	{/if}
</div>

{#snippet favoriteToggle(player: FieldPlayerRow)}
	{@const favorited = favoritedIds.has(player.id)}
	<Button
		class="hover:bg-brass/50"
		type="button"
		variant="ghost"
		size="icon-sm"
		disabled={favoritePending[player.id]}
		aria-pressed={favorited}
		aria-label={favorited
			? `Remove ${formatPlayerName(player)} from favorites`
			: `Add ${formatPlayerName(player)} to favorites`}
		onclick={() => toggleFavorite(player.id)}
	>
		<StarIcon class={favorited ? 'fill-brass text-brass' : 'text-ink/40'} />
	</Button>
{/snippet}

{#snippet currentHigh(high: RealtimeBid | null, size: 'sm' | 'lg' = 'sm')}
	{#if !bidsReady}
		<!-- Matches the line-height of whichever text size the caller renders
		     the real value at (desktop table's inherited text-sm vs the
		     mobile card's text-lg) so swapping in real data doesn't reflow
		     the row/card around it. -->
		<Skeleton class={size === 'lg' ? 'h-7 w-20' : 'h-5 w-16'} />
	{:else if high}
		<span class="inline-flex">
			{#each currencyChars(formatCurrency(high.amount)) as { char, isDigit, key } (key)}
				{#if isDigit}
					<SlotMachineDigit digit={char} delayMs={key * 60} spinIn={pastInitialLoad} />
				{:else}
					<span
						class="inline-block text-center align-bottom"
						style="height: 1.2em; width: 0.62em; line-height: 1.2em;">{char}</span
					>
				{/if}
			{/each}
		</span>
		{#if high.bidder_name && !tournament.bid_anonymity_enabled}
			<span class="ml-1 font-sans text-xs text-ink/60">({high.bidder_name})</span>
		{:else if high.bidder_id === currentUserId}
			<span class="ml-1 font-sans text-xs text-ink/60">(Your bid)</span>
		{/if}
		{#if high.placed_by_admin_id}
			<!-- Phase 32: shown regardless of bid_anonymity_enabled, since
			     this flags who acted (an admin) rather than who the bid
			     belongs to, so it doesn't leak the suppressed bidder identity. -->
			<Badge variant="sand" class="ml-1">Admin-placed</Badge>
		{/if}
	{:else}
		-
	{/if}
{/snippet}

{#if filteredPlayers.length === 0}
	<EmptyState title="No players match these filters" />
{:else}
	<!-- Table.Root's own wrapper div is `overflow-x-auto` (for wide-table
	     safety) which, per the CSS overflow spec, forces its computed
	     overflow-y to `auto` too even though only overflow-x was set — that
	     turns the wrapper into a scroll-clipping ancestor of its own,
	     silently breaking `position: sticky` for anything inside it (it
	     sticks relative to that never-actually-scrolling wrapper instead of
	     the page). Confirmed directly in-browser, not assumed: the sticky
	     header simply didn't stick until this override. This table's columns
	     are narrow enough not to need horizontal scroll protection at the
	     md+ widths it's shown at, so overflow-visible here is safe.

	     Every `top-*` value below is offset by AppShell's own sticky header
	     (h-14 = 3.5rem) — these stick within the page, one level down from
	     that outer header, not the true viewport top. The flight-group row's
	     top-[5.625rem] stacks a second offset on top of that: 3.5rem (header)
	     + 2.125rem (this table header row's own rendered height), so it
	     lands right below the column headers instead of sticking at the
	     same spot and covering them. If AppShell's header height ever
	     changes, these need to move with it. -->
	<div class="[&_[data-slot=table-container]]:overflow-visible">
		<Table.Root class="hidden md:table">
			<Table.Header>
				<Table.Row>
					<Table.Head class="sticky top-14 z-20 w-12 bg-background">#</Table.Head>
					<Table.Head class="sticky top-14 z-20 bg-background">Player</Table.Head>
					<Table.Head class="sticky top-14 z-20 bg-background">Handicap</Table.Head>
					<Table.Head class="sticky top-14 z-20 bg-background">Status</Table.Head>
					<Table.Head class="sticky top-14 z-20 bg-background">Current high</Table.Head>
					<Table.Head class="sticky top-14 z-20 bg-background">Bid</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each groupedPlayers as { group, players } (`${group.flight}::${group.division}`)}
					<Table.Row class="bg-sand/20 hover:bg-sand/20 h-12">
						<Table.Cell
							colspan={6}
							class="sticky top-[5.625rem] z-10 bg-sand font-data text-xs tracking-widest text-fairway uppercase"
						>
							{group.label}
						</Table.Cell>
					</Table.Row>
					{#each players as player, index (player.id)}
						{@const high = currentHighBid(liveBids, player.id)}
						{@const isYou = player.user_id === currentUserId}
						<Table.Row class={player.status === 'reserved' ? 'bg-flag/10' : ''}>
							<Table.Cell class="font-data text-ink/60">{index + 1}</Table.Cell>
							<Table.Cell class="font-medium text-ink">
								<div class="flex flex-wrap items-center gap-1.5">
									{@render favoriteToggle(player)}
									<a
										href={routes.tournamentPlayer(tournament.slug, player.slug)}
										class="hover:underline">{formatPlayerName(player)}</a
									>
									<DivisionBadge division={player.division} />
									{#if isYou}
										<Badge variant="brass">This is you</Badge>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell class="font-data whitespace-nowrap"
								>{formatHandicapIndex(player.handicap_index)}</Table.Cell
							>
							<Table.Cell class="whitespace-nowrap">
								<Badge variant={playerStatusBadgeVariant(player.status)}>
									{playerStatusLabel(player.status)}
								</Badge>
							</Table.Cell>
							<Table.Cell class="font-data whitespace-nowrap">
								{@render currentHigh(high)}
							</Table.Cell>
							<Table.Cell>
								{#if player.status === 'open'}
									<form
										class="flex flex-col gap-2"
										onsubmit={(event) => {
											event.preventDefault();
											placeBid(player.id);
										}}
									>
										<div class="flex items-center gap-2">
											<Input
												type="number"
												step="0.01"
												min="0.01"
												placeholder={suggestedBid(player.id).toFixed(2)}
												bind:value={bidAmounts[player.id]}
												disabled={bidPending[player.id]}
												class="w-32 shrink-0"
											/>
											<Button
												type="submit"
												variant="brass"
												disabled={bidPending[player.id]}
												class="shrink-0"
											>
												Bid
											</Button>
										</div>
										{#if bidErrors[player.id]}
											<p class="text-xs text-flag">{bidErrors[player.id]}</p>
										{/if}
									</form>
								{:else}
									<p class="text-xs text-ink/60">Not open for bidding.</p>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				{/each}
			</Table.Body>
		</Table.Root>
	</div>

	<div class="flex flex-col gap-4 md:hidden">
		{#each groupedPlayers as { group, players } (`${group.flight}::${group.division}`)}
			<div class="flex flex-col gap-2">
				<!-- top-14 offsets below AppShell's own sticky header (h-14),
				     same reasoning as the desktop table's sticky cells above. -->
				<h3
					class="font-data sticky top-14 z-10 -mx-4 border-b border-brass/30 bg-background px-4 py-2 text-sm font-semibold tracking-widest text-fairway uppercase sm:-mx-8 sm:px-8"
				>
					{group.label}
				</h3>
				<div class="flex flex-col gap-3">
					{#each players as player, index (player.id)}
						{@const high = currentHighBid(liveBids, player.id)}
						{@const isYou = player.user_id === currentUserId}
						<PlayerListCard
							slug={tournament.slug}
							playerSlug={player.slug}
							name={formatPlayerName(player)}
							division={player.division}
							{isYou}
							handicap={formatHandicapIndex(player.handicap_index)}
							position={index + 1}
							statusLabel={playerStatusLabel(player.status)}
							statusVariant={playerStatusBadgeVariant(player.status)}
							reserved={player.status === 'reserved'}
							isFavorited={favoritedIds.has(player.id)}
							favoritePending={!!favoritePending[player.id]}
							onToggleFavorite={() => toggleFavorite(player.id)}
						>
							<div class="flex flex-col gap-3">
								<div>
									<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
										Current high
									</p>
									<!-- div, not p — currentHigh's skeleton branch renders a Skeleton
									     (a <div>), and a <div> inside a <p> is invalid HTML; the browser
									     silently closes the <p> early to recover, producing a different DOM
									     tree than the one SSR rendered and triggering a hydration mismatch
									     (reported directly against production, via svelte.dev/e/hydration_mismatch
									     — reproduced locally with a dev build, which additionally logs the
									     specific `node_invalid_placement_ssr` warning naming this exact nesting). -->
									<div class="font-data text-lg">{@render currentHigh(high, 'lg')}</div>
								</div>
								{#if player.status === 'open'}
									<form
										class="flex items-center gap-2"
										onsubmit={(event) => {
											event.preventDefault();
											placeBid(player.id);
										}}
									>
										<Input
											type="number"
											step="0.01"
											min="0.01"
											placeholder={suggestedBid(player.id).toFixed(2)}
											bind:value={bidAmounts[player.id]}
											disabled={bidPending[player.id]}
											class="min-w-0 flex-1"
										/>
										<Button
											type="submit"
											variant="brass"
											disabled={bidPending[player.id]}
											class="shrink-0"
										>
											Bid
										</Button>
									</form>
									{#if bidErrors[player.id]}
										<p class="text-xs text-flag">{bidErrors[player.id]}</p>
									{/if}
								{:else}
									<p class="text-xs text-ink/60">Not open for bidding.</p>
								{/if}
							</div>
						</PlayerListCard>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/if}
