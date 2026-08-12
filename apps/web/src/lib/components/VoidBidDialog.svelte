<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type { Database, VoidBidRequest, VoidBidResponse } from '@emgc-calcutta/shared-types';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';

	let {
		open = $bindable(false),
		supabase,
		bidId,
		playerName,
		amount,
		onSuccess
	}: {
		open?: boolean;
		supabase: SupabaseClient<Database>;
		bidId: string;
		playerName: string;
		amount: number;
		onSuccess?: () => void;
	} = $props();

	function formatCurrency(value: number): string {
		return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	let reason = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');

	// Re-seeded every time the dialog opens, not carried over between
	// different bids — same reset pattern as BuyBackModal's own message.
	$effect(() => {
		if (open) {
			errorMessage = '';
			reason = '';
		}
	});

	async function confirmVoid() {
		const trimmedReason = reason.trim();
		if (!trimmedReason) return;

		submitting = true;
		errorMessage = '';

		const { data, error } = await supabase.functions.invoke<VoidBidResponse>('void-bid', {
			body: { bidId, reason: trimmedReason } satisfies VoidBidRequest
		});

		submitting = false;

		if (error) {
			errorMessage = 'Failed to void this bid';
			if (error instanceof FunctionsHttpError) {
				const errBody = await error.context.json().catch(() => null);
				if (errBody?.error) errorMessage = errBody.error;
			}
			return;
		}

		// Only ever fires for a closed live lot's winning bid (silent bids
		// have no lot to recompute against) — called out explicitly rather
		// than left to a silent table refresh, since this changes who owes
		// money for the player, not just this one bid's own status.
		if (data?.recomputed) {
			toast(
				data.new_winning_bid
					? `Winner recomputed for ${playerName} — now ${data.new_winning_bid.bidder_name ?? 'an unnamed bidder'} at ${formatCurrency(data.new_winning_bid.amount)}.`
					: `${playerName} has no remaining bids after this void — status reverted to no bid.`
			);
		}

		onSuccess?.();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Void {formatCurrency(amount)} bid on {playerName}?</Dialog.Title>
			<Dialog.Description>
				This soft-voids the bid — it's logged and reversible by an Owner, not deleted outright. A
				reason is required.
			</Dialog.Description>
		</Dialog.Header>

		{#if errorMessage}<p class="text-sm text-destructive">{errorMessage}</p>{/if}

		<div class="flex flex-col gap-1.5">
			<Label for="void-reason">Reason</Label>
			<Textarea id="void-reason" rows={3} bind:value={reason} disabled={submitting} required />
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={submitting}>Cancel</Button>
			<Button variant="destructive" onclick={confirmVoid} disabled={submitting || !reason.trim()}>
				{submitting ? 'Voiding…' : 'Void bid'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
