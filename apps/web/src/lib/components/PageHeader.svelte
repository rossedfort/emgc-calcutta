<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		eyebrow?: string;
		actions?: Snippet;
	}

	let { title, eyebrow, actions }: Props = $props();
</script>

<div class="flex flex-wrap items-end justify-between gap-2">
	<div class="flex flex-col gap-0.5">
		{#if eyebrow}
			<p class="font-data text-[0.65rem] tracking-widest text-brass uppercase">{eyebrow}</p>
		{/if}
		<h2 class="font-display text-2xl font-semibold text-ink">{title}</h2>
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</div>
