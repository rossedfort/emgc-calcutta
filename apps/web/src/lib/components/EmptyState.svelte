<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Empty from '$lib/components/ui/empty';

	let {
		title,
		description,
		variant = 'default',
		icon,
		actions
	}: {
		title: string;
		description?: string;
		/** 'destructive' is for genuine failures (a load/query that errored) — not for "no rows yet", which is normal and shouldn't look alarming. */
		variant?: 'default' | 'destructive';
		icon?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<Empty.Root
	class={variant === 'destructive' ? 'border-flag/40 bg-flag/5' : 'border-brass/30 bg-scorecard/40'}
>
	<Empty.Header>
		{#if icon}
			<Empty.Media
				variant="icon"
				class={variant === 'destructive' ? 'bg-flag/10 text-flag' : 'bg-brass/10 text-brass'}
			>
				{@render icon()}
			</Empty.Media>
		{/if}
		<Empty.Title class="font-display text-base text-ink">{title}</Empty.Title>
		{#if description}
			<Empty.Description class="text-ink/70">{description}</Empty.Description>
		{/if}
	</Empty.Header>
	{#if actions}
		<Empty.Content>
			{@render actions()}
		</Empty.Content>
	{/if}
</Empty.Root>
