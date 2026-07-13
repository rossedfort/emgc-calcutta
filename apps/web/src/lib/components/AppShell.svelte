<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		isAdmin: boolean;
		supabase: SupabaseClient;
		children: Snippet;
	}

	let { isAdmin, supabase, children }: Props = $props();

	async function signOut() {
		await supabase.auth.signOut();
	}

	const navLinkClass =
		'rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground';
</script>

<div class="flex min-h-screen flex-col">
	<header class="flex items-center justify-between border-b px-6 py-3">
		<span class="font-semibold text-foreground">EMGC Calcutta</span>
		<Button onclick={signOut} variant="outline" size="sm">Sign out</Button>
	</header>

	<div class="flex flex-1">
		<nav class="flex w-56 shrink-0 flex-col gap-1 border-r p-4 text-sm">
			<a href={resolve('/')} class={navLinkClass}>Home</a>

			{#if isAdmin}
				<p class="mt-4 px-2 text-xs font-semibold text-muted-foreground uppercase">Admin</p>
				<a href={resolve('/admin/tournaments')} class={navLinkClass}>Tournaments</a>
				<a href={resolve('/admin/users')} class={navLinkClass}>Users</a>
			{/if}
		</nav>

		<main class="flex-1 p-8">
			{@render children()}
		</main>
	</div>
</div>
