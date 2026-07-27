<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';

	interface Option {
		value: string;
		label: string;
	}

	let {
		label,
		options,
		selected = $bindable([])
	}: {
		label: string;
		options: Option[];
		selected: string[];
	} = $props();

	function toggle(value: string, checked: boolean) {
		selected = checked ? [...selected, value] : selected.filter((v) => v !== value);
	}

	function remove(value: string) {
		selected = selected.filter((v) => v !== value);
	}

	function labelFor(value: string): string {
		return options.find((o) => o.value === value)?.label ?? value;
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm">
					{label}{selected.length > 0 ? ` (${selected.length})` : ''}
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start">
			{#each options as option (option.value)}
				<DropdownMenu.CheckboxItem
					checked={selected.includes(option.value)}
					closeOnSelect={false}
					onCheckedChange={(checked) => toggle(option.value, checked)}
				>
					{option.label}
				</DropdownMenu.CheckboxItem>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	{#each selected as value (value)}
		<Badge variant="brass" class="gap-1">
			{labelFor(value)}
			<button
				type="button"
				class="ml-0.5 leading-none hover:opacity-70"
				aria-label="Remove {labelFor(value)} filter"
				onclick={() => remove(value)}
			>
				&times;
			</button>
		</Badge>
	{/each}
</div>
