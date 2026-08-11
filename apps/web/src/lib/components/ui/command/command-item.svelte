<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CommandPrimitive.ItemProps = $props();
</script>

<CommandPrimitive.Item
	bind:ref
	data-slot="command-item"
	class={cn(
		"group/command-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-selected:bg-muted data-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<!-- Plain inline checkmark instead of shadcn-svelte "nova" style's
	     IconPlaceholder (a multi-icon-library abstraction this project has
	     never adopted elsewhere) — this codebase has no icon library
	     dependency at all today, so introducing one just for this glyph
	     would be a bigger footprint than the combobox itself needs. -->
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="ml-auto size-4 shrink-0 opacity-0 group-data-[checked=true]/command-item:opacity-100"
	>
		<path d="M20 6 9 17l-5-5" />
	</svg>
</CommandPrimitive.Item>
