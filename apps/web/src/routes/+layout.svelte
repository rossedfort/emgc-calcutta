<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import '../app.css';
	import AppShell from '$lib/components/AppShell.svelte';

	let { data, children } = $props();
	let { session, supabase, profile, pendingUserCount } = $derived(data);

	const loginPath = resolve('/login');

	onMount(() => {
		const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
			if (newSession?.expires_at === session?.expires_at) {
				return;
			}

			// Awaited deliberately, not fired-and-forgotten: this is what
			// actually updates `session` below (dropping AppShell) and, for
			// the branch below, has to fully land before goto() reads it —
			// calling both without sequencing them raced (goto()'s
			// navigation landing before invalidate()'s data had, leaving
			// AppShell still wrapped around /login), reproduced directly
			// against a real cross-tab sign-out before fixing.
			await invalidate('supabase:auth');

			// A session that goes away entirely (token expired in a
			// backgrounded tab, or signed out in another tab) needs a real
			// navigation on top of that — invalidate() alone reruns this
			// root layout's own load, dropping AppShell, but leaves
			// whatever page happened to already be mounted rendering its
			// own never-invalidated (now-stale) data on top of nothing.
			// Every route except /login requires a session, so bouncing
			// there unconditionally mirrors the redirect(303, '/login')
			// every protected route's own server load already does — this
			// just covers the case where no fresh navigation/SSR happens on
			// its own for a tab that's just sitting open.
			if (!newSession && page.url.pathname !== loginPath) {
				goto(loginPath);
			}
		});

		return () => authListener.subscription.unsubscribe();
	});
</script>

<svelte:head>
	<title>{page.data.title}</title>
	<meta name="description" content={page.data.description} />
</svelte:head>

{#if session}
	<AppShell {profile} {supabase} {pendingUserCount}>
		{@render children()}
	</AppShell>
{:else if page.url.pathname === loginPath}
	{@render children()}
{:else}
	<div class="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
		Redirecting to sign in…
	</div>
{/if}
