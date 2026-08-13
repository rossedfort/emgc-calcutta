<script lang="ts">
	import type { Snippet } from 'svelte';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';

	// Phase 37: the shared icon-in-header trigger every column filter (text
	// or checkbox-list) is built on — a small button embedded in a
	// Table.Head cell, filled/highlighted when that column has an active
	// filter, opening a Popover anchored to it rather than a form/row of
	// inputs floating above the whole table. `open` is bindable so callers
	// (TableHeaderTextFilter/TableHeaderSelectFilter) can reset their own
	// draft state exactly when the popover opens, not continuously — the
	// same "reset on open, not on every render" pattern VoidBidDialog
	// already uses.
	let {
		label,
		active = false,
		open = $bindable(false),
		children
	}: {
		label: string;
		active?: boolean;
		open?: boolean;
		children: Snippet;
	} = $props();
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant={active ? 'brass' : 'ghost'}
				size="icon-xs"
				aria-label="Filter {label}"
			>
				<FilterIcon class="size-3" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-64" align="start">
		{@render children()}
	</Popover.Content>
</Popover.Root>
