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

<div class="flex min-h-screen items-center justify-center bg-fairway p-6">
	<div
		class="w-full max-w-sm rounded-lg border border-brass/30 bg-scorecard p-8 text-ink shadow-sm"
	>
		<p class="font-data text-xs tracking-widest text-fairway uppercase">EMGC &middot; Calcutta</p>
		<h1 class="mt-2 font-display text-3xl font-semibold text-ink">Sign in</h1>
		<p class="mt-2 text-sm text-ink/70">
			Sign in to browse players and bid in the league's Calcutta auction.
		</p>

		<div class="mt-4 border-t border-brass/40"></div>

		<div class="mt-6 flex flex-col gap-2">
			<Button onclick={() => signInWith('google')} variant="brass" class="w-full">
				Sign in with Google
			</Button>
			<Button onclick={() => signInWith('azure')} variant="brass" class="w-full">
				Sign in with Microsoft
			</Button>
		</div>
	</div>
</div>
