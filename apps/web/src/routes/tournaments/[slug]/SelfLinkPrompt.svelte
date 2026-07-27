<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { formatPlayerName } from '$lib/players';
	import type { FieldPlayerRow } from './+page.server';

	let { unlinkedPlayers }: { unlinkedPlayers: FieldPlayerRow[] } = $props();

	let submitting = $state(false);
	let errorMessage = $state('');
</script>

<div
	class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brass/30 bg-scorecard/40 p-4"
>
	<p class="text-sm text-ink">
		Playing in this tournament? Link yourself to your name on the field so you can bid.
	</p>

	{#if unlinkedPlayers.length === 0}
		<p class="text-sm text-ink/60">No unlinked players left to pick from — ask an Admin.</p>
	{:else}
		<form
			method="POST"
			action="?/linkSelf"
			class="flex items-center gap-2"
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
			<select
				name="playerId"
				required
				disabled={submitting}
				class="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
			>
				<option value="" disabled selected>Choose your name</option>
				{#each unlinkedPlayers as player (player.id)}
					<option value={player.id}>{formatPlayerName(player)}</option>
				{/each}
			</select>
			<Button type="submit" variant="brass" size="sm" disabled={submitting}>
				{submitting ? 'Linking…' : 'This is me'}
			</Button>
		</form>
	{/if}
</div>
{#if errorMessage}
	<p class="text-xs text-flag">{errorMessage}</p>
{/if}
