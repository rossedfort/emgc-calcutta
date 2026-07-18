<script lang="ts">
	import type { RealtimeConnectionStatus } from '$lib/stores/realtime';

	let { status }: { status: RealtimeConnectionStatus } = $props();
</script>

{#if status === 'reconnecting'}
	<div
		class="flex items-center gap-2 rounded-md border border-flag/40 bg-flag/10 px-3 py-2 text-sm text-flag"
		role="status"
	>
		<span class="inline-block size-2 animate-pulse rounded-full bg-flag"></span>
		Reconnecting — live updates are paused until the connection is back.
	</div>
{/if}
