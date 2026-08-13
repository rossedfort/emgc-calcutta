<script lang="ts">
	// Companion to LiveClock, mirrored on the opposite side of the TV page
	// header — this one is driven by real bid data (not a tick), so it only
	// updates when a new bid actually lands.
	let { placedAt }: { placedAt: string | null } = $props();

	const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
</script>

<span class="font-data text-lg tabular-nums text-ink/70 xl:text-xl">
	{#if placedAt}
		Last bid {dateTimeFormatter.format(new Date(placedAt))}
	{:else}
		No bids yet
	{/if}
</span>
