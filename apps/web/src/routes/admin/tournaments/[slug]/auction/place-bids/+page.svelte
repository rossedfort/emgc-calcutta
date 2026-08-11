<script lang="ts">
	import { onMount } from 'svelte';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type {
		ErrorResponse,
		PlaceBidRequest,
		PlaceBidResponse,
		RealtimeBid,
		RealtimeLiveLot,
		RealtimePlayerEntry
	} from '@emgc-calcutta/shared-types';
	import Combobox from '$lib/components/Combobox.svelte';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { currentHighBid } from '$lib/bids';
	import { formatPlayerName } from '$lib/players';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';
	import { tournamentPhase } from '$lib/tournamentPhase';

	let { data } = $props();

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

	let phaseInfo = $derived(tournamentPhase(data.tournament, now));

	// Entry statuses stay live-updated the same way the merged live auction
	// screen's own player list does — a silent bid crossing the threshold
	// (from anyone, not just this screen) should drop that entry out of the
	// open-entry search without a page reload.
	let currentEntries = $derived(
		data.entries.map((entry) => {
			const live = liveEntries.find((e) => e.id === entry.id);
			return live ? { ...entry, status: live.status } : entry;
		})
	);
	let openEntries = $derived(currentEntries.filter((entry) => entry.status === 'open'));

	// At most one lot should ever be opened-but-not-closed at a time, same
	// invariant the live auction screen relies on.
	let currentLot = $derived(
		liveLots.find((lot) => lot.opened_at !== null && lot.closed_at === null) ?? null
	);
	let liveTargetEntry = $derived(
		currentLot ? (currentEntries.find((e) => e.id === currentLot!.entry_id) ?? null) : null
	);

	// Silent phase: the admin searches for the entry directly (many are open
	// at once). Live phase: there's only ever one open lot, so it's targeted
	// automatically — no search needed, matching the live auction screen's
	// own "current lot" derivation.
	let entryId = $state<string | null>(null);
	let targetEntry = $derived(
		phaseInfo.phase === 'live'
			? liveTargetEntry
			: (currentEntries.find((e) => e.id === entryId) ?? null)
	);

	let bidderId = $state<string | null>(null);
	let participantOptions = $derived(
		data.participants.map((p) => ({ value: p.id, label: p.name, description: p.email }))
	);
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

	let high = $derived(targetEntry ? currentHighBid(liveBids, targetEntry.id) : null);

	// No bid yet on this entry: the floor is the tournament's minimum
	// opening bid (place-bid's own `!highBid` branch, Phase 21), not
	// min_increment — increment only governs beating an *existing* high bid.
	let suggestedBid = $derived(
		high ? high.amount + data.tournament.min_increment : data.tournament.minimum_bid
	);

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let bidAmount = $state<string | number>('');
	let bidPending = $state(false);
	let bidError = $state('');
	let successMessage = $state('');

	async function placeBid() {
		if (!bidderId || !targetEntry) return;
		const raw = bidAmount;
		const amount = raw === undefined || raw === '' ? suggestedBid : Number(raw);
		if (!Number.isFinite(amount) || amount <= 0) {
			bidError = 'Enter a valid bid amount';
			return;
		}

		bidPending = true;
		bidError = '';
		successMessage = '';

		const participantName = data.participants.find((p) => p.id === bidderId)?.name ?? 'participant';
		const entryName = formatPlayerName(targetEntry);

		const { error: invokeError } = await data.supabase.functions.invoke<PlaceBidResponse>(
			'place-bid',
			{ body: { entryId: targetEntry.id, amount, bidderId } satisfies PlaceBidRequest }
		);

		bidPending = false;

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
			bidError = message;
			return;
		}

		bidAmount = '';
		// The participant most likely changes bid-to-bid (many different
		// people bidding through an admin in quick succession) — resetting
		// this after every success avoids the highest-risk mistake in a
		// proxy-bidding tool, an admin forgetting to change it and
		// re-submitting for the wrong person. The entry selection is left
		// as-is during silent phase: it's common for several people to bid
		// on the same golfer back to back during the last-hour rush.
		bidderId = null;
		successMessage = `Bid of ${formatCurrency(amount)} placed for ${participantName} on ${entryName}`;
	}
</script>

<div class="flex flex-col gap-4 pt-4">
	<RealtimeStatusBanner status={connectionStatus} />

	{#if phaseInfo.phase === 'silent'}
		<p class="text-sm text-ink/70">
			The minimum opening bid is {formatCurrency(data.tournament.minimum_bid)}. Bids of {formatCurrency(
				data.tournament.threshold_amount
			)} or more reserve a player for the live auction — each new bid must beat the current high by at
			least {formatCurrency(data.tournament.min_increment)}.
		</p>
	{/if}

	{#if phaseInfo.phase !== 'silent' && phaseInfo.phase !== 'live'}
		<EmptyState
			title="Bidding isn't open right now"
			description={phaseInfo.phase === 'upcoming'
				? "The silent auction hasn't started yet."
				: phaseInfo.phase === 'between'
					? 'The silent auction has closed — start the live auction from the Settings tab to continue.'
					: 'This tournament has already been completed.'}
		/>
	{:else if phaseInfo.phase === 'live' && !liveTargetEntry}
		<EmptyState
			title="Waiting for the next lot"
			description="Advance the queue on the Live auction tab before placing bids."
		/>
	{:else}
		<div class="flex flex-col gap-4 rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
			<div class="flex flex-col gap-1">
				<span class="font-data text-xs tracking-widest text-fairway uppercase">Participant</span>
				<Combobox
					options={participantOptions}
					bind:value={bidderId}
					placeholder="Search by name or email…"
					emptyText="No participants found."
				/>
			</div>

			{#if phaseInfo.phase === 'silent'}
				<div class="flex flex-col gap-1">
					<span class="font-data text-xs tracking-widest text-fairway uppercase">Player</span>
					<Combobox
						options={entryOptions}
						bind:value={entryId}
						placeholder="Search by name…"
						emptyText="No open players found."
					/>
				</div>
			{:else if liveTargetEntry}
				<div class="flex flex-col gap-1">
					<span class="font-data text-xs tracking-widest text-fairway uppercase">Player</span>
					<p class="flex items-center gap-2 font-display text-lg font-semibold text-ink">
						{formatPlayerName(liveTargetEntry)}
						<DivisionBadge division={liveTargetEntry.division} />
					</p>
				</div>
			{/if}

			{#if targetEntry}
				<div
					class="grid grid-cols-1 gap-px overflow-hidden rounded border border-brass/40 bg-brass/40 sm:grid-cols-2"
				>
					<div class="flex flex-col gap-1 bg-scorecard p-3">
						<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
							Current high
						</span>
						<span class="font-data text-lg text-ink">
							{high ? formatCurrency(high.amount) : 'No bids yet'}
						</span>
					</div>
				</div>
			{/if}

			<form
				class="flex flex-col gap-2"
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
						placeholder={targetEntry ? suggestedBid.toFixed(2) : ''}
						bind:value={bidAmount}
						disabled={bidPending || !targetEntry || !bidderId}
						class="h-11 text-base"
					/>
					<Button type="submit" variant="brass" disabled={bidPending || !targetEntry || !bidderId}>
						{bidPending ? 'Placing…' : 'Place bid'}
					</Button>
				</div>
				{#if bidError}
					<Badge variant="flag" class="w-fit">{bidError}</Badge>
				{/if}
				{#if successMessage}
					<Badge variant="fairway" class="w-fit">{successMessage}</Badge>
				{/if}
			</form>
		</div>
	{/if}
</div>
