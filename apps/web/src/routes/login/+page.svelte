<script lang="ts">
	import { Button } from '$lib/components/ui/button';

	let { data } = $props();
	let { supabase } = $derived(data);

	async function signInWith(provider: 'google' | 'azure') {
		await supabase.auth.signInWithOAuth({
			provider,
			options: { redirectTo: `${window.location.origin}/auth/callback` }
		});
	}
</script>

<div class="mx-auto flex max-w-md flex-col gap-4 p-8">
	<h1 class="text-2xl font-semibold text-foreground">emgc-calcutta</h1>
	<p class="text-sm text-muted-foreground">Sign in to continue</p>
	<div class="flex gap-2">
		<Button onclick={() => signInWith('google')} class="w-fit">Sign in with Google</Button>
		<Button onclick={() => signInWith('azure')} class="w-fit">Sign in with Microsoft</Button>
	</div>
</div>
