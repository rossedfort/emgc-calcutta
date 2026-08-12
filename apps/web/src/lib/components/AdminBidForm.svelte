<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type {
		Database,
		ErrorResponse,
		PlaceBidRequest,
		PlaceBidResponse
	} from '@emgc-calcutta/shared-types';
	import Combobox from '$lib/components/Combobox.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	// The bidder/amount/submit half of admin-on-behalf-of bidding (Phase 32),
	// shared between the Live auction and Silent auction bids tabs — each
	// owns its own "which entry" selection (auto-targeted current lot vs. a
	// type-ahead search) and passes the resolved entry down here, since
	// that's the one part that genuinely differs between the two.
	let {
		supabase,
		tournament,
		participants,
		entryId,
		entryLabel,
		highBid,
		onSuccess
	}: {
		supabase: SupabaseClient<Database>;
		tournament: { min_increment: number; minimum_bid: number };
		participants: { id: string; name: string; email: string }[];
		entryId: string | null;
		entryLabel: string | null;
		highBid: { amount: number } | null;
		onSuccess?: () => void;
	} = $props();

	let bidderId = $state<string | null>(null);
	let participantOptions = $derived(
		participants.map((p) => ({ value: p.id, label: p.name, description: p.email }))
	);

	// No bid yet on this entry: the floor is the tournament's minimum
	// opening bid (place-bid's own `!highBid` branch, Phase 21), not
	// min_increment — increment only governs beating an *existing* high bid.
	let suggestedBid = $derived(
		highBid ? highBid.amount + tournament.min_increment : tournament.minimum_bid
	);

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let bidAmount = $state<string | number>('');
	let bidPending = $state(false);
	let bidError = $state('');
	let successMessage = $state('');

	async function placeBid() {
		if (!bidderId || !entryId) return;
		const raw = bidAmount;
		const amount = raw === undefined || raw === '' ? suggestedBid : Number(raw);
		if (!Number.isFinite(amount) || amount <= 0) {
			bidError = 'Enter a valid bid amount';
			return;
		}

		bidPending = true;
		bidError = '';
		successMessage = '';

		const participantName = participants.find((p) => p.id === bidderId)?.name ?? 'participant';

		const { error: invokeError } = await supabase.functions.invoke<PlaceBidResponse>('place-bid', {
			body: { entryId, amount, bidderId } satisfies PlaceBidRequest
		});

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
		// re-submitting for the wrong person. The entry selection (owned by
		// the caller, not this component) is left untouched either way.
		bidderId = null;
		successMessage = `Bid of ${formatCurrency(amount)} placed for ${participantName}${entryLabel ? ` on ${entryLabel}` : ''}`;
		onSuccess?.();
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-1">
		<span class="font-data text-xs tracking-widest text-fairway uppercase">Participant</span>
		<Combobox
			options={participantOptions}
			bind:value={bidderId}
			placeholder="Search by name or email…"
			emptyText="No participants found."
		/>
	</div>

	<div
		class="grid grid-cols-1 gap-px overflow-hidden rounded border border-brass/40 bg-brass/40 sm:grid-cols-2"
	>
		<div class="flex flex-col gap-1 bg-scorecard p-3">
			<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
				Current high
			</span>
			<span class="font-data text-lg text-ink">
				{#if !entryId}
					—
				{:else if highBid}
					{formatCurrency(highBid.amount)}
				{:else}
					No bids yet
				{/if}
			</span>
		</div>
	</div>

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
				placeholder={entryId ? suggestedBid.toFixed(2) : ''}
				bind:value={bidAmount}
				disabled={bidPending || !entryId || !bidderId}
				class="h-11 text-base"
			/>
			<Button type="submit" variant="brass" disabled={bidPending || !entryId || !bidderId}>
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
