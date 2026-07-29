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
		golferName,
		tournamentName,
		percentage,
		amount,
		buyer,
		onSuccess
	}: {
		open?: boolean;
		supabase: SupabaseClient<Database>;
		entryId: string;
		golferName: string;
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
	let subject = $derived(`Buy-back request: ${golferName} — ${tournamentName}`);
	let buyerName = $derived([buyer.first_name, buyer.last_name].filter(Boolean).join(' '));

	let body = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');

	// Reset to the pre-baked draft every time the modal opens, not just
	// once on mount — the same modal instance gets reused across different
	// rows in "Your stake" (Phase 14), so a previous open's edits (or a
	// previous row's golfer/amount) must never leak into the next one.
	$effect(() => {
		if (open) {
			errorMessage = '';
			body =
				`Hi${buyer.first_name ? ` ${buyer.first_name}` : ''},\n\n` +
				`${golferName} would like to buy back ${percentageDisplay}% of their stake in ${tournamentName} for ${formatCurrency(amount)}.\n\n` +
				`Let me know if that works.\n\nThanks!`;
		}
	});

	// This app doesn't send this email itself (unlike every other email it
	// touches, all real Resend sends) — the whole point is it genuinely
	// comes from the golfer, not noreply@mail.emgc.bet. Opening the
	// golfer's own mail client is a separate, explicit action (the "Email
	// {buyer}" link below) rather than an automatic side effect of
	// submitting the request — a mailto: navigation firing without the
	// golfer choosing it was surprising in practice.
	let mailtoHref = $derived(
		`mailto:${buyer.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
	);

	async function submitRequest() {
		submitting = true;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('request-stake-buyback', {
			body: { entryId }
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
				Sends a request to {buyerName || buyer.email}. You can also email them directly using the
				draft below.
			</Dialog.Description>
		</Dialog.Header>

		{#if errorMessage}<p class="text-sm text-destructive">{errorMessage}</p>{/if}

		<div class="flex flex-col gap-3">
			<div class="flex flex-col gap-1 text-sm">
				<span class="text-ink/60">To</span>
				<span class="text-ink">{buyer.email}</span>
			</div>
			{#if buyer.phone}
				<div class="flex flex-col gap-1 text-sm">
					<span class="text-ink/60">Phone</span>
					<span class="text-ink">{buyer.phone}</span>
				</div>
			{/if}

			<div class="flex flex-col gap-1.5">
				<Label for="buyback-body">Email body</Label>
				<Textarea id="buyback-body" rows={7} bind:value={body} disabled={submitting} />
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="brass" onclick={() => (open = false)} disabled={submitting}>Cancel</Button>
			<Button variant="outline" href={mailtoHref}>Email {buyerName || buyer.email}</Button>
			<Button variant="brass" onclick={submitRequest} disabled={submitting}>
				{submitting ? 'Sending…' : 'Send request'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
