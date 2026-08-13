<script lang="ts">
	import { untrack } from 'svelte';
	import TableHeaderFilterButton from '$lib/components/TableHeaderFilterButton.svelte';
	import { Button } from '$lib/components/ui/button';

	interface Option {
		value: string;
		label: string;
	}

	// Phase 37: checkbox-list variant of the header-embedded column filter
	// (Role/Status/Flight) — same role MultiSelectFilter already plays
	// standalone above a table, relocated into a Table.Head popover. Not
	// built on MultiSelectFilter directly: that component's checkbox rows
	// are bits-ui DropdownMenu.CheckboxItems, which only exist inside a
	// DropdownMenu.Content, not a Popover.Content — plain native checkboxes
	// styled to match are simpler here than forcing two different menu
	// primitives to share one popover shell. Applies once via Apply/Clear,
	// not per-checkbox-toggle, so a server-driven table doesn't re-navigate
	// on every click while someone's still selecting multiple values.
	let {
		label,
		options,
		selected,
		onApply
	}: {
		label: string;
		options: Option[];
		selected: string[];
		onApply: (selected: string[]) => void;
	} = $props();

	let open = $state(false);
	let draft = $state<string[]>(untrack(() => [...selected]));

	$effect(() => {
		if (open) {
			draft = [...selected];
		}
	});

	function toggle(value: string, checked: boolean) {
		draft = checked ? [...draft, value] : draft.filter((v) => v !== value);
	}

	function apply() {
		onApply(draft);
		open = false;
	}

	function clear() {
		draft = [];
		onApply([]);
		open = false;
	}
</script>

<TableHeaderFilterButton {label} active={selected.length > 0} bind:open>
	<div class="flex flex-col gap-1">
		{#each options as option (option.value)}
			<label
				class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
			>
				<input
					type="checkbox"
					checked={draft.includes(option.value)}
					onchange={(event) => toggle(option.value, event.currentTarget.checked)}
					class="size-4 rounded border-input accent-brass"
				/>
				{option.label}
			</label>
		{/each}
	</div>
	<div class="mt-1 flex justify-end gap-2 border-t border-border pt-2">
		{#if selected.length > 0 || draft.length > 0}
			<Button type="button" variant="outline" size="sm" onclick={clear}>Clear</Button>
		{/if}
		<Button type="button" variant="brass" size="sm" onclick={apply}>Apply</Button>
	</div>
</TableHeaderFilterButton>
