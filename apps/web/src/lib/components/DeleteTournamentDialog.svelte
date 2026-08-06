<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type { Database } from '@emgc-calcutta/shared-types';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';

	let {
		open = $bindable(false),
		supabase,
		tournamentId,
		tournamentName,
		onSuccess
	}: {
		open?: boolean;
		supabase: SupabaseClient<Database>;
		tournamentId: string;
		tournamentName: string;
		onSuccess?: () => void;
	} = $props();

	let submitting = $state(false);
	let errorMessage = $state('');

	$effect(() => {
		if (open) errorMessage = '';
	});

	async function confirmDelete() {
		submitting = true;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('delete-tournament', {
			body: { tournamentId }
		});

		submitting = false;

		if (error) {
			errorMessage = 'Failed to delete tournament';
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
			<Dialog.Title>Delete {tournamentName}?</Dialog.Title>
			<Dialog.Description>
				This permanently deletes every player, bid, and auction record for this dry run. It can't be
				undone.
			</Dialog.Description>
		</Dialog.Header>

		{#if errorMessage}<p class="text-sm text-destructive">{errorMessage}</p>{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={submitting}>Cancel</Button>
			<Button variant="destructive" onclick={confirmDelete} disabled={submitting}>
				{submitting ? 'Deleting…' : 'Yes, delete'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
