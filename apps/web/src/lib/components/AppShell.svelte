<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { initials } from '$lib/initials';
	import type { UserProfile } from '$lib/profile';
	import { goto } from '$app/navigation';

	interface Props {
		profile: UserProfile | null;
		supabase: SupabaseClient;
		children: Snippet;
	}

	let { profile, supabase, children }: Props = $props();

	let isAdmin = $derived(profile?.role === 'admin' || profile?.role === 'owner');

	async function signOut() {
		const { error } = await supabase.auth.signOut();
		if (!error) {
			goto(resolve('/login'));
		}
	}

	const navLinkClass =
		'rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground';
</script>

<div class="flex min-h-screen flex-col">
	<header class="flex items-center justify-between border-b px-6 py-3">
		<span class="font-semibold text-foreground">EMGC Calcutta</span>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				<Avatar.Root size="sm">
					<Avatar.Image src={profile?.avatar_url} alt={profile?.name ?? profile?.email} />
					<Avatar.Fallback>
						{profile ? initials(profile.name ?? profile.email) : '?'}
					</Avatar.Fallback>
				</Avatar.Root>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a href={resolve('/profile')} {...props}>View profile</a>
					{/snippet}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={signOut}>Log out</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
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
