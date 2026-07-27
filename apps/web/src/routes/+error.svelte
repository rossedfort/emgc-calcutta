<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Button } from '$lib/components/ui/button';

	// 404s here are always a deliberately-authored, safe-to-show message
	// (e.g. "Tournament not found") — but a 500 usually carries a raw
	// Postgres/query error string (see the many `error(500, x.message)`
	// call sites across `+page.server.ts` files), which isn't meant for an
	// end user to read. Only 404 (and anything else that isn't a bare
	// server failure) surfaces the real message; a 500 always shows a
	// generic one instead.
	let description = $derived(
		page.status === 500
			? 'Something went wrong on our end. Try again in a moment.'
			: (page.error?.message ?? 'An unexpected error occurred.')
	);
</script>

<div class="flex flex-1 items-center justify-center p-4 sm:p-8">
	<EmptyState variant="destructive" title="Error {page.status}" {description}>
		{#snippet actions()}
			<Button href={resolve('/')} variant="brass" size="sm">Go home</Button>
		{/snippet}
	</EmptyState>
</div>
