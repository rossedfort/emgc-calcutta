<script lang="ts">
	import { page, updated } from '$app/state';
	import '../app.css';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { toast } from 'svelte-sonner';

	let { children } = $props();

	// Same "notify idle clients of a new deployment" mechanism as before
	// (see vite.config.ts's kit.version.pollInterval) — now a persistent
	// toast instead of a dismissible top banner. duration: Infinity keeps
	// it up until the user dismisses it (the Toaster's own close button)
	// or actually refreshes, matching the same "stays until acted on"
	// intent the banner had. `notified` guards against firing more than
	// once per page load — updated.current never goes back to false on
	// its own, so without this guard every unrelated re-run of this effect
	// would queue up a duplicate toast.
	let notified = false;
	$effect(() => {
		if (updated.current && !notified) {
			notified = true;
			toast('A new version of the app is available.', {
				duration: Infinity,
				action: {
					label: 'Refresh',
					onClick: () => location.reload()
				}
			});
		}
	});
</script>

<svelte:head>
	<title>{page.data.title}</title>
	<meta name="description" content={page.data.description} />
</svelte:head>

<Toaster closeButton />

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
