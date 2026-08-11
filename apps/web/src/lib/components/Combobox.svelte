<script lang="ts">
	import * as Command from '$lib/components/ui/command';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	// Single-select type-ahead search over a bounded, already-loaded option
	// list (Popover + Command, matching every other filter in this app's
	// admin/participant tables — client-side filtering at bounded scale, not
	// a server round-trip per keystroke). Generic over Option so the same
	// component covers both the "Place bids" participant search and its
	// entry search (Phase 32), which differ only in what's in the list.
	interface Option {
		value: string;
		label: string;
		description?: string;
	}

	let {
		options,
		value = $bindable(null),
		placeholder = 'Search…',
		searchPlaceholder = 'Search…',
		emptyText = 'No results found.',
		disabled = false
	}: {
		options: Option[];
		value: string | null;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		disabled?: boolean;
	} = $props();

	let open = $state(false);
	let selected = $derived(options.find((o) => o.value === value) ?? null);

	function select(option: Option) {
		value = option.value;
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				{disabled}
				class="w-full justify-between font-normal"
				role="combobox"
				aria-expanded={open}
			>
				<span class={cn('truncate', !selected && 'text-muted-foreground')}>
					{selected ? selected.label : placeholder}
				</span>
				<span class="text-muted-foreground">⌄</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-(--bits-popover-anchor-width) p-0" align="start">
		<Command.Root>
			<Command.Input placeholder={searchPlaceholder} />
			<Command.List>
				<Command.Empty>{emptyText}</Command.Empty>
				<Command.Group>
					{#each options as option (option.value)}
						<Command.Item value={option.label} onSelect={() => select(option)}>
							<div class="flex flex-col">
								<span>{option.label}</span>
								{#if option.description}
									<span class="text-xs text-muted-foreground">{option.description}</span>
								{/if}
							</div>
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
