<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableRowElement>> = $props();
</script>

<tr
	bind:this={ref}
	data-slot="table-row"
	class={cn(
		'border-b border-brass/20 transition-colors hover:bg-sand/20 data-[state=selected]:bg-sand/30',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tr>
