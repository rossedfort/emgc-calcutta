<script lang="ts">
	import { page } from '$app/state';
	import '../app.css';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import UpdateBanner from '$lib/components/UpdateBanner.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>{page.data.title}</title>
	<meta name="description" content={page.data.description} />
</svelte:head>

<UpdateBanner />

<!-- Catches unhandled errors thrown while rendering/updating the component
     tree on the client (a bug in a $derived, an effect, template markup) —
     the one class of failure +error.svelte can't catch, since that only
     ever runs for errors thrown during SvelteKit's own load/routing (SSR
     or client-side navigation), not for a crash that happens mid-render
     after the page has already loaded. Wrapped at the true root so it
     covers the whole app, not just the (app) shell group — including the
     shell-less TV display route, which runs unattended for potentially
     hours during a live auction and has no one nearby to notice a stuck
     tab, let alone refresh it themselves. -->
<svelte:boundary onerror={(error) => console.error('Unhandled rendering error:', error)}>
	{@render children()}
	{#snippet failed()}
		<ErrorState description="Something went wrong on our end. Try again in a moment." />
	{/snippet}
</svelte:boundary>
