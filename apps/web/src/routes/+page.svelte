<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';

	let { data } = $props();
	let { supabase, session } = $derived(data);

	let authStatus: 'pending' | 'ok' | 'error' = $state('pending');
	let dbStatus: 'pending' | 'ok' | 'error' = $state('pending');
	let dbDetail = $state('');

	async function runCheck() {
		authStatus = 'pending';
		dbStatus = 'pending';
		dbDetail = '';

		const { error: authError } = await supabase.auth.getSession();
		authStatus = authError ? 'error' : 'ok';

		// No tables exist yet with an open RLS policy (Phase 1 defers those to
		// the RLS policies task), so a "trivial query" here just needs to
		// confirm the anon key + URL reach PostgREST at all. A PGRST205
		// "relation not found" response means the request was authenticated
		// and handled correctly — any other error means it never reached the
		// database.
		const { error: dbError } = await supabase.from('_connection_check').select().limit(1);
		if (!dbError || dbError.code === 'PGRST205') {
			dbStatus = 'ok';
		} else {
			dbStatus = 'error';
			dbDetail = dbError.message;
		}
	}

	onMount(runCheck);

	async function signInWithGoogle() {
		await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: { redirectTo: `${window.location.origin}/auth/callback` }
		});
	}

	async function signOut() {
		await supabase.auth.signOut();
	}
</script>

<div class="mx-auto flex max-w-md flex-col gap-4 p-8">
	<h1 class="text-2xl font-semibold text-foreground">emgc-calcutta</h1>

	<div class="flex flex-col gap-1 text-sm">
		<p class="text-muted-foreground">Auth session:</p>
		{#if session}
			<p>Signed in as <span class="font-medium">{session.user.email}</span></p>
			<Button onclick={signOut} variant="outline" class="w-fit">Sign out</Button>
		{:else}
			<p>Not signed in</p>
			<Button onclick={signInWithGoogle} class="w-fit">Sign in with Google</Button>
		{/if}
	</div>

	<div class="flex flex-col gap-1 text-sm">
		<p class="text-muted-foreground">Supabase connectivity check:</p>
		<ul class="flex flex-col gap-1">
			<li>Auth: <span class="font-medium">{authStatus}</span></li>
			<li>Database: <span class="font-medium">{dbStatus}</span> {dbDetail}</li>
		</ul>
		<Button onclick={runCheck} variant="outline" class="w-fit">Re-run check</Button>
	</div>
</div>
