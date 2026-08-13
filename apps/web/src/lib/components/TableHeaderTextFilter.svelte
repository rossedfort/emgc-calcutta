<script lang="ts">
	import { untrack } from 'svelte';
	import TableHeaderFilterButton from '$lib/components/TableHeaderFilterButton.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	// Phase 37: text-input variant of the header-embedded column filter
	// (Actor/Player/Bidder/Search across Audit, Silent bids, Live bids,
	// Users). Deliberately not applied on every keystroke — a draft value
	// is held locally and only handed to `onApply` on submit/Clear, same
	// "apply once, not per-click" reasoning the checkbox-list variant
	// needs to avoid a server-driven table re-navigating on every toggle;
	// kept consistent here too rather than having the two variants behave
	// differently.
	let {
		label,
		value,
		placeholder,
		onApply
	}: {
		label: string;
		value: string;
		placeholder?: string;
		onApply: (value: string) => void;
	} = $props();

	let open = $state(false);
	let draft = $state(untrack(() => value));

	// Re-seeded from the currently-applied value only when the popover
	// opens, not continuously — otherwise this would clobber the user's
	// own typing on every parent re-render.
	$effect(() => {
		if (open) {
			draft = value;
		}
	});

	function apply() {
		onApply(draft.trim());
		open = false;
	}

	function clear() {
		draft = '';
		onApply('');
		open = false;
	}
</script>

<TableHeaderFilterButton {label} active={value !== ''} bind:open>
	<form
		class="flex flex-col gap-2"
		onsubmit={(event) => {
			event.preventDefault();
			apply();
		}}
	>
		<Input type="text" {placeholder} bind:value={draft} autofocus />
		<div class="flex justify-end gap-2">
			{#if value !== '' || draft !== ''}
				<Button type="button" variant="outline" size="sm" onclick={clear}>Clear</Button>
			{/if}
			<Button type="submit" variant="brass" size="sm">Apply</Button>
		</div>
	</form>
</TableHeaderFilterButton>
