<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AppShell from '$lib/components/AppShell.svelte';

	let { data, children } = $props();
	let { session, supabase, profile } = $derived(data);

	onMount(() => {
		const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
			if (newSession?.expires_at !== session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		return () => authListener.subscription.unsubscribe();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{page.data.title}</title>
	<meta name="description" content={page.data.description} />
</svelte:head>

{#if session}
	<AppShell {profile} {supabase}>
		{@render children()}
	</AppShell>
{:else}
	{@render children()}
{/if}
