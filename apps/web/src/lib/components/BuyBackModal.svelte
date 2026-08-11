<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type {
		Database,
		ErrorResponse,
		RequestStakeBuybackRequest,
		RequestStakeBuybackResponse
	} from '@emgc-calcutta/shared-types';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';

	interface Buyer {
		first_name: string | null;
		last_name: string | null;
		email: string;
		phone: string | null;
	}

	// Phase 33: the percentage is now the golfer's own choice, not a fixed
	// value read off the tournament — maxPercentage is only the *default*
	// the input pre-fills with (the tournament's auto-approval ceiling,
	// still the least-friction choice), and winningBidAmount is the raw
	// bid amount the preview/request recompute against as that choice
	// changes, rather than a single pre-computed amount prop.
	let {
		open = $bindable(false),
		supabase,
		entryId,
		tournamentName,
		maxPercentage,
		winningBidAmount,
		buyer,
		onSuccess
	}: {
		open?: boolean;
		supabase: SupabaseClient<Database>;
		entryId: string;
		tournamentName: string;
		maxPercentage: number;
		winningBidAmount: number;
		buyer: Buyer;
		onSuccess?: () => void;
	} = $props();

	function formatCurrency(value: number): string {
		return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let buyerName = $derived([buyer.first_name, buyer.last_name].filter(Boolean).join(' '));

	// Whole-number percent, matching the tournament settings form's own
	// "type 50, store 0.5" convention — divided by 100 before it's sent.
	let percentageInput = $state<string | number>(0);
	let percentageFraction = $derived(
		typeof percentageInput === 'number' ? percentageInput / 100 : Number(percentageInput || 0) / 100
	);
	let previewAmount = $derived(winningBidAmount * percentageFraction);

	let message = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');

	// Set once a request succeeds — swaps the dialog body to a confirmation
	// view instead of closing outright, since "was this auto-approved or
	// not" is exactly the kind of outcome a golfer needs to actually read,
	// not have flash by as a closing modal.
	let result = $state<{ autoApproved: boolean; percentage: number; amount: number } | null>(null);

	// Re-seeded every time the modal opens, not a live mirror of anything —
	// the golfer edits both freely from here. No mailto: draft (that
	// approach was tried and dropped) — the note travels with the request
	// itself and is sent to the buyer inside the automated Resend email,
	// alongside the pre-baked "X wants to buy back Y% for $Z" copy (only
	// for the "needs a response" outcome — an auto-approved request never
	// sends that email, so the note has nowhere to appear if entered on the
	// one that auto-approves; kept anyway rather than hidden conditionally,
	// since the golfer can't know the outcome until after submitting).
	$effect(() => {
		if (open) {
			errorMessage = '';
			result = null;
			percentageInput = Math.round(maxPercentage * 100);
			message = `Hi${buyer.first_name ? ` ${buyer.first_name}` : ''}, let me know if that works. Thanks!`;
		}
	});

	async function submitRequest() {
		if (
			!Number.isFinite(percentageFraction) ||
			percentageFraction <= 0 ||
			percentageFraction >= 1
		) {
			errorMessage = 'Enter a percentage between 1 and 99';
			return;
		}

		submitting = true;
		errorMessage = '';

		const { data, error } = await supabase.functions.invoke<RequestStakeBuybackResponse>(
			'request-stake-buyback',
			{
				body: {
					entryId,
					percentage: percentageFraction,
					message: message.trim() || null
				} satisfies RequestStakeBuybackRequest
			}
		);

		submitting = false;

		if (error) {
			let failureMessage = 'Failed to send buy-back request';
			if (error instanceof FunctionsHttpError) {
				const body = (await error.context.json().catch(() => null)) as ErrorResponse | null;
				if (body?.error) failureMessage = body.error;
			}
			errorMessage = failureMessage;
			return;
		}

		result = data!.stakeBuyback;
		onSuccess?.();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		{#if result}
			<Dialog.Header>
				<Dialog.Title>
					{result.autoApproved ? 'Approved automatically' : 'Request sent'}
				</Dialog.Title>
				<Dialog.Description>
					{#if result.autoApproved}
						You now keep {Math.round(result.percentage * 100)}% of your stake ({formatCurrency(
							result.amount
						)}) — this was within {tournamentName}'s pre-approved percentage, so no response from {buyerName ||
							buyer.email} was needed.
					{:else}
						{buyerName || buyer.email} has been emailed your request to buy back {Math.round(
							result.percentage * 100
						)}% of your stake in {tournamentName} for {formatCurrency(result.amount)}. We'll let you
						know once they respond.
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="brass" onclick={() => (open = false)}>Close</Button>
			</Dialog.Footer>
		{:else}
			<Dialog.Header>
				<Dialog.Title>Buy back your stake</Dialog.Title>
				<Dialog.Description>
					Choose what percentage to buy back. {Math.round(maxPercentage * 100)}% or less is approved
					automatically — no need to wait on {buyerName || buyer.email}. More than that sends them
					your request to accept or decline.
				</Dialog.Description>
			</Dialog.Header>

			{#if errorMessage}<p class="text-sm text-destructive">{errorMessage}</p>{/if}

			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-1 text-sm">
					<span class="text-ink/60">To</span>
					<span class="text-ink">{buyerName || buyer.email}</span>
				</div>
				{#if buyer.phone}
					<div class="flex flex-col gap-1 text-sm">
						<span class="text-ink/60">Phone</span>
						<span class="text-ink">{buyer.phone}</span>
					</div>
				{/if}

				<div class="flex flex-col gap-1.5">
					<Label for="buyback-percentage">Percentage to buy back</Label>
					<div class="flex items-center gap-2">
						<Input
							id="buyback-percentage"
							type="number"
							min="1"
							max="99"
							step="1"
							bind:value={percentageInput}
							disabled={submitting}
							class="w-24"
						/>
						<span class="text-sm text-ink/70">% = {formatCurrency(previewAmount)}</span>
					</div>
				</div>

				<div class="flex flex-col gap-1.5">
					<Label for="buyback-message">Note (optional)</Label>
					<Textarea id="buyback-message" rows={5} bind:value={message} disabled={submitting} />
				</div>
			</div>

			<Dialog.Footer>
				<Button variant="brass" onclick={() => (open = false)} disabled={submitting}>Cancel</Button>
				<Button variant="brass" onclick={submitRequest} disabled={submitting}>
					{submitting ? 'Sending…' : 'Send request'}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
