<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { initials } from '$lib/initials';
	import type { UserProfile } from '$lib/profile';

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

	// Home only matches the exact root; admin sections stay "current" across
	// their nested routes (e.g. /admin/tournaments/new, .../[id]/edit).
	function isCurrent(path: string): boolean {
		if (path === '/') return page.url.pathname === '/';
		return page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
	}

	function navLinkClass(path: string): string {
		return isCurrent(path)
			? 'flex items-center gap-2 rounded px-2 py-1.5 bg-brass/10 font-medium text-fairway'
			: 'flex items-center gap-2 rounded px-2 py-1.5 text-ink/60 hover:bg-brass/10 hover:text-fairway';
	}
</script>

{#snippet navDot(path: string)}
	<span class={['size-1.5 shrink-0 rounded-full', isCurrent(path) ? 'bg-brass' : 'bg-transparent']}
	></span>
{/snippet}

<div class="flex min-h-screen flex-col">
	<header class="flex items-center justify-between bg-fairway px-6 py-3">
		<span class="font-data text-xs tracking-widest text-brass uppercase"
			>EMGC &middot; Calcutta</span
		>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				<Avatar.Root size="sm" class="ring-2 ring-brass/40">
					<Avatar.Image src={profile?.avatar_url} alt={profile?.name ?? profile?.email} />
					<Avatar.Fallback class="bg-scorecard font-data text-fairway">
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
		<nav class="flex w-56 shrink-0 flex-col gap-1 border-r border-brass/30 bg-sand/25 p-4 text-sm">
			<a href={resolve('/')} class={navLinkClass('/')}>
				{@render navDot('/')}
				<span>Home</span>
			</a>

			{#if isAdmin}
				<div class="mt-3 mb-1 border-t border-brass/30 pt-3">
					<p class="font-data px-2 text-[0.65rem] tracking-widest text-brass/80 uppercase">Admin</p>
				</div>
				<a href={resolve('/admin/tournaments')} class={navLinkClass('/admin/tournaments')}>
					{@render navDot('/admin/tournaments')}
					<span>Tournaments</span>
				</a>
				<a href={resolve('/admin/users')} class={navLinkClass('/admin/users')}>
					{@render navDot('/admin/users')}
					<span>Users</span>
				</a>
			{/if}
		</nav>

		<main class="flex-1 p-8">
			{@render children()}
		</main>
	</div>
</div>
