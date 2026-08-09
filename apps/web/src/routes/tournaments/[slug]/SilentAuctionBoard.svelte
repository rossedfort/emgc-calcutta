<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type {
		Database,
		ErrorResponse,
		PlaceBidRequest,
		PlaceBidResponse,
		RealtimeBid
	} from '@emgc-calcutta/shared-types';
	import { resolve } from '$app/paths';
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
	import { currentHighBid } from '$lib/bids';
	import {
		PLAYER_STATUSES,
		formatHandicapIndex,
		formatPlayerName,
		playerStatusBadgeVariant,
		playerStatusLabel
	} from '$lib/players';
	import { groupPlayersByFlightAndDivision } from '$lib/flightGroups';
	import type { FieldPlayerRow } from './+page.server';

	let {
		tournament,
		players,
		liveBids,
		bidsReady,
		currentUserId,
		supabase
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

	// Collapses a Championship flight's separate Gross/Net pot groups back
	// into a single box (two labeled lines instead of two boxes) — with 4
	// regular flights already filling a 4-wide row, Championship's extra
	// division split pushed the box count to 5 and stranded one lonely box
	// on its own second row (reported directly, screenshot of a 5-flight
	// tournament). The player-list sections above intentionally keep
	// Gross/Net as fully separate sections (own bids, own "current high" —
	// see groupedPlayers' own comment); this merge is purely cosmetic, for
	// this summary grid only. Relies on deriveFlightDivisionGroups always
	// emitting a flight's 'gross' group immediately before its 'net' group.
	let potBoxes = $derived.by(() => {
		const boxes: { flight: string; label: string; lines: { label: string; total: number }[] }[] =
			[];
		for (const { group, total } of potGroups) {
			const prev = boxes[boxes.length - 1];
			if (group.division === 'net' && prev && prev.flight === group.flight) {
				prev.lines.push({ label: 'Net', total });
				continue;
			}
			boxes.push({
				flight: group.flight,
				label: group.division === 'gross' ? group.flight : group.label,
				lines: [{ label: group.division === 'gross' ? 'Gross' : '', total }]
			});
		}
		return boxes;
	});

	// Splits a formatted amount ("$1,850.00") into characters for the
	// slot-machine effect, each keyed by distance from the *end* of the
	// string rather than the start — bid amounts only ever grow (a bid must
	// beat the current high), so a new leading digit appearing (e.g.
	// "$99.00" -> "$100.00") only ever prepends a character; keying from the
	// right means the existing trailing digits' SlotMachineDigit instances
	// (and the mid-spin state they're holding) keep their identity instead
	// of every position remapping to a different character.
	function currencyChars(formatted: string): { char: string; isDigit: boolean; key: number }[] {
		const chars = formatted.split('');
		return chars.map((char, i) => ({
			char,
			isDigit: char >= '0' && char <= '9',
			key: chars.length - 1 - i
		}));
	}

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
	{#if potBoxes.length > 1}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					{#each potBoxes as box, i (i)}
						<Table.Head>{box.label}</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				<Table.Row>
					{#each potBoxes as box, i (i)}
						<Table.Cell class="font-data">
							{#if box.lines.length > 1}
								<!-- Same wrapper/label markup whether or not bidsReady — only the
								     amount itself swaps for a skeleton — so a box's line count
								     (known up front from tournament.flights, independent of bids)
								     keeps this cell's height identical across the transition. -->
								<div class="flex flex-col gap-0.5">
									{#each box.lines as line (line.label)}
										<div class="flex items-baseline gap-2">
											<span class="text-[0.6rem] tracking-wider text-ink/50 uppercase"
												>{line.label}</span
											>
											{#if bidsReady}
												<span>{formatCurrency(line.total)}</span>
											{:else}
												<Skeleton class="h-5 w-14" />
											{/if}
										</div>
									{/each}
								</div>
							{:else if bidsReady}
								{formatCurrency(box.lines[0].total)}
							{:else}
								<Skeleton class="h-5 w-16" />
							{/if}
						</Table.Cell>
					{/each}
				</Table.Row>
			</Table.Body>
		</Table.Root>
	{/if}
</div>

<p class="text-sm text-ink/70">
	The minimum opening bid is {formatCurrency(tournament.minimum_bid)}. Bids of {formatCurrency(
		tournament.threshold_amount
	)} or more reserve a player for the live auction — each new bid must beat the current high by at least
	{formatCurrency(tournament.min_increment)}.
</p>

<div class="flex flex-wrap items-center gap-4 text-sm">
	<Input type="search" placeholder="Search players…" bind:value={searchQuery} class="max-w-56" />
	<MultiSelectFilter label="Status" options={statusOptions} bind:selected={statusFilters} />
	{#if flightOptions.length > 0}
		<MultiSelectFilter label="Flight" options={flightOptions} bind:selected={flightFilters} />
	{/if}
</div>

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
	     md+ widths it's shown at, so overflow-visible here is safe. -->
	<div class="[&_[data-slot=table-container]]:overflow-visible">
		<Table.Root class="hidden md:table">
			<Table.Header>
				<Table.Row>
					<Table.Head class="sticky top-0 z-20 w-12 bg-background">#</Table.Head>
					<Table.Head class="sticky top-0 z-20 bg-background">Player</Table.Head>
					<Table.Head class="sticky top-0 z-20 bg-background">Handicap</Table.Head>
					<Table.Head class="sticky top-0 z-20 bg-background">Status</Table.Head>
					<Table.Head class="sticky top-0 z-20 bg-background">Current high</Table.Head>
					<Table.Head class="sticky top-0 z-20 bg-background">Bid</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each groupedPlayers as { group, players } (`${group.flight}::${group.division}`)}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell
							colspan={6}
							class="sticky top-8.5 z-10 bg-sand font-data text-xs tracking-widest text-fairway uppercase"
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
								<a
									href={resolve('/tournaments/[slug]/players/[playerSlug]', {
										slug: tournament.slug,
										playerSlug: player.slug
									})}
									class="hover:underline">{formatPlayerName(player)}</a
								>
								<DivisionBadge division={player.division} />
								{#if isYou}
									<Badge variant="brass">This is you</Badge>
								{/if}
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
				<h3
					class="font-data sticky top-0 z-10 -mx-4 border-b border-brass/30 bg-background px-4 py-2 text-sm font-semibold tracking-widest text-fairway uppercase sm:-mx-8 sm:px-8"
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
						>
							<div class="flex flex-col gap-3">
								<div>
									<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
										Current high
									</p>
									<p class="font-data text-lg">{@render currentHigh(high, 'lg')}</p>
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
