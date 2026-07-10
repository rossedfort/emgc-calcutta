<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { Button } from '$lib/components/ui/button';

	let authStatus: 'pending' | 'ok' | 'error' = $state('pending');
	let dbStatus: 'pending' | 'ok' | 'error' = $state('pending');
	let dbDetail = $state('');

	async function runCheck() {
		authStatus = 'pending';
		dbStatus = 'pending';
		dbDetail = '';

		const { error: authError } = await supabase.auth.getSession();
		authStatus = authError ? 'error' : 'ok';

		// No tables exist yet (Phase 1), so a "trivial query" here just needs to
		// confirm the anon key + URL reach PostgREST at all. A PGRST205 "relation
		// not found" response means the request was authenticated and handled
		// correctly — any other error means it never reached the database.
		const { error: dbError } = await supabase.from('_connection_check').select().limit(1);
		if (!dbError || dbError.code === 'PGRST205') {
			dbStatus = 'ok';
		} else {
			dbStatus = 'error';
			dbDetail = dbError.message;
		}
	}

	onMount(runCheck);
</script>

<div class="mx-auto flex max-w-md flex-col gap-4 p-8">
	<h1 class="text-2xl font-semibold text-foreground">emgc-calcutta</h1>
	<p class="text-sm text-muted-foreground">Supabase connectivity check:</p>
	<ul class="flex flex-col gap-1 text-sm">
		<li>Auth: <span class="font-medium">{authStatus}</span></li>
		<li>Database: <span class="font-medium">{dbStatus}</span> {dbDetail}</li>
	</ul>
	<Button onclick={runCheck} class="w-fit">Re-run check</Button>
</div>
