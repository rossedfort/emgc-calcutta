<script lang="ts">
	// Purely presentational — the caller owns the `setInterval` tick that
	// advances `now`, same as the countdown timers on both TV boards.
	let { now }: { now: Date } = $props();

	const timeFormatter = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit'
	});
</script>

<span class="font-data text-lg tabular-nums text-ink/70 xl:text-xl">
	Current Time {timeFormatter.format(now)}
</span>
