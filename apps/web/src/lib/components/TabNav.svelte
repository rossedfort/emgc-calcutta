<script lang="ts">
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
		size = 'default'
	}: {
		tabs: {
			href: string;
			label: string;
			exact?: boolean;
			match?: string;
			matchPrefix?: string;
		}[];
		size?: 'default' | 'sub';
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
	class="flex gap-4 overflow-x-auto border-b {size === 'sub'
		? 'border-brass/20'
		: 'border-brass/30'}"
>
	{#each tabs as tab (tab.href)}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers already build tab.href via resolve(); this component only ever receives typed routes, it just can't call resolve() itself since that needs a literal route id -->
		<a href={tab.href} class={tabClass(tab)}>{tab.label}</a>
	{/each}
</nav>
