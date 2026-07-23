<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { data } = $props();
	let { supabase } = $derived(data);

	type Step = 'providers' | 'email' | 'code';
	let step = $state<Step>('providers');
	let email = $state('');
	let code = $state('');
	let error = $state<string | null>(null);
	let sending = $state(false);
	let verifying = $state(false);

	async function signInWith(provider: 'google' | 'azure') {
		await supabase.auth.signInWithOAuth({
			provider,
			options: { redirectTo: `${window.location.origin}/auth/callback` }
		});
	}

	// Supabase's default email template sends one email containing both a
	// magic-link URL (handled by the existing /auth/callback route, same as
	// the OAuth providers) and this 6-digit code — one call covers both entry
	// points rather than these being two separate features.
	async function sendCode(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		sending = true;
		const { error: otpError } = await supabase.auth.signInWithOtp({
			email,
			options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
		});
		sending = false;

		if (otpError) {
			error = otpError.message;
			return;
		}
		step = 'code';
	}

	// Fallback for anyone who copies the code instead of clicking the link
	// (e.g. reading the email on a different device than the one signing in).
	async function verifyCode(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		verifying = true;
		const { error: verifyError } = await supabase.auth.verifyOtp({
			email,
			token: code,
			type: 'email'
		});
		verifying = false;

		if (verifyError) {
			error = verifyError.message;
			return;
		}

		// Mirrors /auth/callback's post-sign-in check — this path never hits
		// that route, so it's repeated here. Best-effort: a failure shouldn't
		// block sign-in.
		const { error: bootstrapError } = await supabase.functions.invoke('bootstrap-owner');
		if (bootstrapError) {
			console.error('bootstrap-owner invocation failed:', bootstrapError);
		}

		goto(resolve('/'));
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

		{#if step === 'providers'}
			<div class="mt-6 flex flex-col gap-2">
				<Button onclick={() => signInWith('google')} variant="brass" class="w-full">
					Sign in with Google
				</Button>
				<Button onclick={() => signInWith('azure')} variant="brass" class="w-full">
					Sign in with Microsoft
				</Button>
				<Button onclick={() => (step = 'email')} variant="outline" class="w-full">
					Continue with email
				</Button>
			</div>
		{:else if step === 'email'}
			<form class="mt-6 flex flex-col gap-3" onsubmit={sendCode}>
				<div class="flex flex-col gap-1.5">
					<Label for="email">Email address</Label>
					<Input
						id="email"
						type="email"
						autocomplete="email"
						bind:value={email}
						required
						disabled={sending}
					/>
				</div>
				{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
				<Button type="submit" variant="brass" class="w-full" disabled={sending}>
					{sending ? 'Sending…' : 'Send me a code'}
				</Button>
				<button
					type="button"
					class="text-sm text-ink/60 underline"
					onclick={() => {
						step = 'providers';
						error = null;
					}}
				>
					Back
				</button>
			</form>
		{:else if step === 'code'}
			<form class="mt-6 flex flex-col gap-3" onsubmit={verifyCode}>
				<p class="text-sm text-ink/70">
					We sent a sign-in link and a 6-digit code to <strong>{email}</strong>. Click the link, or
					enter the code below.
				</p>
				<div class="flex flex-col gap-1.5">
					<Label for="code">6-digit code</Label>
					<Input
						id="code"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength={6}
						bind:value={code}
						required
						disabled={verifying}
					/>
				</div>
				{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
				<Button type="submit" variant="brass" class="w-full" disabled={verifying}>
					{verifying ? 'Verifying…' : 'Verify code'}
				</Button>
				<button
					type="button"
					class="text-sm text-ink/60 underline"
					onclick={() => {
						step = 'email';
						error = null;
						code = '';
					}}
				>
					Use a different email
				</button>
			</form>
		{/if}
	</div>
</div>
