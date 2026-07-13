<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		actions?: Snippet;
	}

	let { title, actions }: Props = $props();
</script>

<div class="flex items-center justify-between">
	<div class="flex flex-col gap-0.5">
		<p class="font-data text-[0.65rem] tracking-widest text-brass uppercase">Admin</p>
		<h2 class="font-display text-2xl font-semibold text-ink">{title}</h2>
	</div>
	{#if actions}
		<div class="flex items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</div>
