<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { formatHandicapIndex, formatPlayerName } from '$lib/players';
	import type { FieldPlayerRow } from './+page.server';

	let { unlinkedPlayers }: { unlinkedPlayers: FieldPlayerRow[] } = $props();

	let submitting = $state(false);
	let errorMessage = $state('');
</script>

<Dialog.Root open={true} onOpenChange={() => {}}>
	<Dialog.Content
		showCloseButton={false}
		escapeKeydownBehavior="ignore"
		interactOutsideBehavior="ignore"
		class="sm:max-w-md"
	>
		<Dialog.Header>
			<Dialog.Title>Which player are you?</Dialog.Title>
			<Dialog.Description>
				Link yourself to your name on the field before you can view or bid in this tournament.
			</Dialog.Description>
		</Dialog.Header>

		{#if unlinkedPlayers.length === 0}
			<p class="text-sm text-ink/70">
				Every player in this tournament is already linked to someone. Ask an Admin to link you.
			</p>
			<Dialog.Footer>
				<Button href={resolve('/')} variant="outline">Back</Button>
			</Dialog.Footer>
		{:else}
			<form
				method="POST"
				action="?/linkSelf"
				class="flex flex-col gap-3"
				use:enhance={() => {
					submitting = true;
					errorMessage = '';
					return async ({ result, update }) => {
						if (result.type === 'failure' && result.data && 'error' in result.data) {
							errorMessage = result.data.error as string;
						}
						await update();
						submitting = false;
					};
				}}
			>
				{#if errorMessage}
					<p class="text-sm text-destructive">{errorMessage}</p>
				{/if}
				<select
					name="playerId"
					required
					disabled={submitting}
					class="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
				>
					<option value="" disabled selected>Choose your name</option>
					{#each unlinkedPlayers as player (player.id)}
						<option value={player.id}
							>{formatPlayerName(player)} - {formatHandicapIndex(player.handicap_index)}</option
						>
					{/each}
				</select>
				<Dialog.Footer>
					<Button href={resolve('/')} variant="outline">Back</Button>
					<Button type="submit" variant="brass" disabled={submitting}>
						{submitting ? 'Joining...' : 'Join'}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
