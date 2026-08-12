<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { PAGE_SIZES } from '$lib/pagination';

	let {
		pageSize,
		hasNext,
		hasPrev,
		nextHref,
		prevHref,
		disabled = false,
		onPageSizeChange
	}: {
		pageSize: number;
		hasNext: boolean;
		hasPrev: boolean;
		nextHref: string | null;
		prevHref: string | null;
		// True while a navigation to this same route is already in flight —
		// disables the controls rather than letting a second click queue up
		// a conflicting navigation.
		disabled?: boolean;
		onPageSizeChange: (size: string) => void;
	} = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<label class="flex items-center gap-2 text-sm text-muted-foreground">
		Rows per page
		<select
			value={pageSize}
			onchange={(e) => onPageSizeChange(e.currentTarget.value)}
			{disabled}
			class="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-50"
		>
			{#each PAGE_SIZES as size (size)}
				<option value={size}>{size}</option>
			{/each}
		</select>
	</label>
	<div class="flex items-center gap-2">
		{#if hasPrev && prevHref && !disabled}
			<Button variant="outline" size="sm" href={prevHref}>Previous</Button>
		{:else}
			<Button variant="outline" size="sm" disabled>Previous</Button>
		{/if}
		{#if hasNext && nextHref && !disabled}
			<Button variant="outline" size="sm" href={nextHref}>Next</Button>
		{:else}
			<Button variant="outline" size="sm" disabled>Next</Button>
		{/if}
	</div>
</div>
