<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	let authStatus: 'pending' | 'ok' | 'error' = $state('pending');
	let dbStatus: 'pending' | 'ok' | 'error' = $state('pending');
	let dbDetail = $state('');

	onMount(async () => {
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
	});
</script>

<h1>emgc-calcutta</h1>
<p>Supabase connectivity check:</p>
<ul>
	<li>Auth: {authStatus}</li>
	<li>Database: {dbStatus} {dbDetail}</li>
</ul>
