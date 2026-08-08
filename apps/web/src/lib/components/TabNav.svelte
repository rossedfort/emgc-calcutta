<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	// Route-navigation tab bar (plain <a> links, not a client-side panel
	// switcher) — used at two nesting levels: the primary tab bar on
	// admin/tournaments/[slug] and the secondary one on its auction/
	// sub-layout. `match` lets a tab (e.g. "Auction") stay highlighted
	// across a whole sub-tree even though it links to just one leaf route
	// within it (there's no +page at the bare /auction segment to link to).
	// `matchPrefix` is for the opposite shape — a tab whose own href IS the
	// exact-matched root (e.g. "Settings", which can't prefix-match since
	// its path is a literal prefix of every other tab's) but that still has
	// exactly one sub-route (edit) it should stay highlighted for.
	let {
		tabs,
		size = 'default',
		trailing
	}: {
		tabs: {
			href: string;
			label: string;
			exact?: boolean;
			match?: string;
			matchPrefix?: string;
		}[];
		size?: 'default' | 'sub';
		// Non-navigation content pinned to the end of the same row as the
		// tabs — the tournament status banner on the primary bar, so it's
		// visible regardless of which tab is active rather than living on
		// just one of the pages underneath.
		trailing?: Snippet;
	} = $props();

	function isActive(tab: (typeof tabs)[number]): boolean {
		const target = tab.match ?? tab.href;
		if (tab.exact) {
			return (
				page.url.pathname === target ||
				(tab.matchPrefix !== undefined &&
					(page.url.pathname === tab.matchPrefix ||
						page.url.pathname.startsWith(`${tab.matchPrefix}/`)))
			);
		}
		return page.url.pathname === target || page.url.pathname.startsWith(`${target}/`);
	}

	function tabClass(tab: (typeof tabs)[number]): string {
		const current = isActive(tab);
		if (size === 'sub') {
			return current
				? 'shrink-0 whitespace-nowrap border-b-2 border-brass px-1 pb-1.5 text-xs font-medium text-ink'
				: 'shrink-0 whitespace-nowrap border-b-2 border-transparent px-1 pb-1.5 text-xs text-muted-foreground hover:text-ink';
		}
		return current
			? 'shrink-0 whitespace-nowrap border-b-2 border-brass px-1 pb-2 text-sm font-medium text-ink'
			: 'shrink-0 whitespace-nowrap border-b-2 border-transparent px-1 pb-2 text-sm text-muted-foreground hover:text-ink';
	}
</script>

<nav
	class="flex flex-col gap-2 border-b {size === 'sub'
		? 'border-brass/20'
		: 'border-brass/30'} sm:flex-row sm:items-end sm:justify-between sm:gap-4"
>
	<div class="flex gap-4 overflow-x-auto">
		{#each tabs as tab (tab.href)}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers already build tab.href via resolve(); this component only ever receives typed routes, it just can't call resolve() itself since that needs a literal route id -->
			<a href={tab.href} class={tabClass(tab)}>{tab.label}</a>
		{/each}
	</div>
	{#if trailing}
		<!-- order-first: stacks above the tabs on narrow screens, so the
		trailing content (e.g. the Live auction control) doesn't squeeze
		the tabs' own horizontal scroll area for room; sm:order-none
		restores DOM order (tabs first) once there's room to sit inline. -->
		<div
			class="order-first flex shrink-0 flex-wrap items-center gap-2 sm:order-none {size === 'sub'
				? 'sm:pb-1.5'
				: 'sm:pb-2'}"
		>
			{@render trailing()}
		</div>
	{/if}
</nav>
