<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	// Inline type-ahead search over a bounded, already-loaded option list
	// (client-side filtering at bounded scale, not a server round-trip per
	// keystroke — matching every other filter in this app's admin/
	// participant tables). Generic over Option so the same component covers
	// both the "Place bids" participant search and its entry search
	// (Phase 32), which differ only in what's in the list.
	//
	// Deliberately built on bits-ui's Command primitive directly rather
	// than a Popover-wrapped "click a button, then search inside it" combo
	// (the first cut of this component, before user feedback): the visible
	// input IS the search field — click in and start typing immediately,
	// the floating panel below it shows only the filtered results, not a
	// second input. A plain absolutely-positioned div stands in for what a
	// Popover would give (floating-ui collision detection, portalling) —
	// not needed here since this always renders inside normal card layout,
	// not a scroll-clipped container.
	interface Option {
		value: string;
		label: string;
		description?: string;
	}

	let {
		options,
		value = $bindable(null),
		placeholder = 'Search…',
		emptyText = 'No results found.',
		disabled = false
	}: {
		options: Option[];
		value: string | null;
		placeholder?: string;
		emptyText?: string;
		disabled?: boolean;
	} = $props();

	let open = $state(false);
	let containerEl = $state<HTMLDivElement | null>(null);

	// A writable $derived (Svelte 5.25+): starts out tracking the current
	// selection's label, but reassigning it (via bind:value as the user
	// types) overrides that until the derived expression itself changes
	// again — e.g. a selection, or the parent resetting `value` to null
	// after a successful submit. That's exactly "sync to the selection,
	// except while the user is actively typing."
	let query = $derived(options.find((o) => o.value === value)?.label ?? '');

	function select(option: Option) {
		value = option.value;
		open = false;
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (containerEl && !containerEl.contains(event.target as Node)) {
			open = false;
		}
	}

	$effect(() => {
		if (!open) return;
		window.addEventListener('pointerdown', handleWindowPointerDown);
		return () => window.removeEventListener('pointerdown', handleWindowPointerDown);
	});
</script>

<div class="relative" bind:this={containerEl}>
	<CommandPrimitive.Root shouldFilter class="contents">
		<CommandPrimitive.Input
			bind:value={query}
			{disabled}
			{placeholder}
			onfocus={() => (open = true)}
			onkeydown={(event) => {
				if (event.key === 'Escape') open = false;
			}}
			class={cn(
				'dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm'
			)}
		/>
		{#if open}
			<div
				class="absolute top-full left-0 z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
			>
				<CommandPrimitive.List>
					<CommandPrimitive.Empty class="px-2 py-6 text-center text-sm text-muted-foreground">
						{emptyText}
					</CommandPrimitive.Empty>
					<CommandPrimitive.Group>
						{#each options as option (option.value)}
							<CommandPrimitive.Item
								value={option.label}
								onSelect={() => select(option)}
								class="flex cursor-default flex-col rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-selected:bg-muted data-selected:text-foreground"
							>
								<span>{option.label}</span>
								{#if option.description}
									<span class="text-xs text-muted-foreground">{option.description}</span>
								{/if}
							</CommandPrimitive.Item>
						{/each}
					</CommandPrimitive.Group>
				</CommandPrimitive.List>
			</div>
		{/if}
	</CommandPrimitive.Root>
</div>
