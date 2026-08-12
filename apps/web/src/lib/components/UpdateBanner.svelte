<script lang="ts">
	import { updated } from '$app/state';
	import XIcon from '@lucide/svelte/icons/x';

	// Rendered at the true root (see +layout.svelte) so it's visible
	// everywhere, including the shell-less live-auction TV display — the one
	// place nobody's around to notice a stale tab any other way. Dismiss
	// only hides this instance; it doesn't touch `updated.current` itself,
	// so a real reload later still picks up the new version regardless.
	let dismissed = $state(false);
</script>

{#if updated.current && !dismissed}
	<div
		class="flex items-center justify-center gap-3 border-b border-brass/40 bg-brass/10 px-4 py-2 text-sm text-brass"
		role="status"
	>
		<span>A new version of the app is available.</span>
		<button
			type="button"
			class="font-medium underline underline-offset-2 hover:no-underline"
			onclick={() => location.reload()}
		>
			Refresh
		</button>
		<button
			type="button"
			class="text-brass/60 hover:text-brass"
			aria-label="Dismiss"
			onclick={() => (dismissed = true)}
		>
			<XIcon class="size-4" />
		</button>
	</div>
{/if}
