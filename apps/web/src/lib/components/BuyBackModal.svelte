<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type { Database } from '@emgc-calcutta/shared-types';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';

	interface Buyer {
		first_name: string | null;
		last_name: string | null;
		email: string;
		phone: string | null;
	}

	let {
		open = $bindable(false),
		supabase,
		entryId,
		tournamentName,
		percentage,
		amount,
		buyer,
		onSuccess
	}: {
		open?: boolean;
		supabase: SupabaseClient<Database>;
		entryId: string;
		tournamentName: string;
		percentage: number;
		amount: number;
		buyer: Buyer;
		onSuccess?: () => void;
	} = $props();

	function formatCurrency(value: number): string {
		return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let percentageDisplay = $derived(Math.round(percentage * 100));
	let buyerName = $derived([buyer.first_name, buyer.last_name].filter(Boolean).join(' '));

	let message = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');

	// No mailto: draft (that approach was tried and dropped) — this note
	// travels with the request itself and is sent to the buyer inside the
	// automated Resend email, alongside the pre-baked "X wants to buy back
	// Y% for $Z" copy. Re-seeded every time the modal opens, not a live
	// mirror of anything, since the golfer edits it freely from here.
	$effect(() => {
		if (open) {
			errorMessage = '';
			message = `Hi${buyer.first_name ? ` ${buyer.first_name}` : ''}, let me know if that works. Thanks!`;
		}
	});

	async function submitRequest() {
		submitting = true;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('request-stake-buyback', {
			body: { entryId, message: message.trim() || null }
		});

		submitting = false;

		if (error) {
			errorMessage = 'Failed to send buy-back request';
			if (error instanceof FunctionsHttpError) {
				const errBody = await error.context.json().catch(() => null);
				if (errBody?.error) errorMessage = errBody.error;
			}
			return;
		}

		onSuccess?.();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Buy back your stake</Dialog.Title>
			<Dialog.Description>
				We'll email {buyerName || buyer.email} that you want to buy back {percentageDisplay}% of
				your stake in {tournamentName} for {formatCurrency(amount)}, along with the note below. No
				need to email them yourself.
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
	</Dialog.Content>
</Dialog.Root>
