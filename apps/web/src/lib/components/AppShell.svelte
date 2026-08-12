<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Snippet } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { initials } from '$lib/initials';
	import { formatUserName, type UserProfile } from '$lib/profile';
	import { routes } from '$lib/routes';

	interface Props {
		profile: UserProfile | null;
		supabase: SupabaseClient;
		pendingUserCount: number | null;
		children: Snippet;
	}

	let { profile, supabase, pendingUserCount, children }: Props = $props();

	let isAdmin = $derived(profile?.role === 'admin' || profile?.role === 'owner');

	// The sidebar nav is a full-width panel that pushes main content down on
	// mobile (below `md`) rather than a permanent column — at phone widths
	// there's no room for both side by side. Closes itself on navigation so
	// picking a link doesn't leave the panel stuck open over the new page.
	let mobileNavOpen = $state(false);
	afterNavigate(() => {
		mobileNavOpen = false;
	});

	async function signOut() {
		const { error } = await supabase.auth.signOut();
		if (!error) {
			goto(routes.login());
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
	<header class="sticky top-0 z-30 flex h-14 items-center justify-between bg-fairway px-4 sm:px-6">
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="text-brass md:hidden"
				aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={mobileNavOpen}
				onclick={() => (mobileNavOpen = !mobileNavOpen)}
			>
				<MenuIcon class="size-5" />
			</button>
			<span class="font-data text-xs tracking-widest text-brass uppercase">EMGC &middot; Bet</span>
		</div>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				<Avatar.Root size="sm" class="ring-2 ring-brass/40">
					<Avatar.Image
						src={profile?.avatar_url}
						alt={(profile && formatUserName(profile)) ?? profile?.email}
					/>
					<Avatar.Fallback class="bg-scorecard font-data text-fairway">
						{profile ? initials(formatUserName(profile) ?? profile.email) : '?'}
					</Avatar.Fallback>
				</Avatar.Root>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a href={routes.profile()} {...props}>View profile</a>
					{/snippet}
				</DropdownMenu.Item>
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a href={routes.settingsNotifications()} {...props}>Notification settings</a>
					{/snippet}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={signOut}>Log out</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<div class="flex flex-1 flex-col md:flex-row">
		<nav
			class={[
				mobileNavOpen ? 'flex' : 'hidden',
				'sticky top-14 z-20 w-full shrink-0 flex-col gap-1 overflow-y-auto border-b border-brass/30 bg-scorecard p-4 text-sm md:flex md:h-[calc(100vh-3.5rem)] md:w-56 md:border-r md:border-b-0'
			]}
		>
			<a href={routes.home()} class={navLinkClass('/')}>
				{@render navDot('/')}
				<span>Home</span>
			</a>
			<a href={routes.help()} class={navLinkClass('/help')}>
				{@render navDot('/help')}
				<span>Help</span>
			</a>

			{#if isAdmin}
				<div class="mt-3 mb-1 border-t border-brass/30 pt-3">
					<p class="font-data px-2 text-[0.65rem] tracking-widest text-brass/80 uppercase">Admin</p>
				</div>
				<a href={routes.adminTournaments()} class={navLinkClass('/admin/tournaments')}>
					{@render navDot('/admin/tournaments')}
					<span>Tournaments</span>
				</a>
				<a href={routes.adminUsers()} class={navLinkClass('/admin/users')}>
					{@render navDot('/admin/users')}
					<span>Users</span>
					{#if pendingUserCount}
						<Badge variant="flag" class="ml-auto">{pendingUserCount}</Badge>
					{/if}
				</a>
				<a href={routes.adminAudit()} class={navLinkClass('/admin/audit')}>
					{@render navDot('/admin/audit')}
					<span>Audit log</span>
				</a>
			{/if}
		</nav>

		<main class="min-w-0 flex-1 p-4 sm:p-8">
			{@render children()}
		</main>
	</div>
</div>
