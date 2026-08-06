<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data, children } = $props();

	function tabClass(href: string, exact: boolean): string {
		const current = exact
			? page.url.pathname === href
			: page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
		return current
			? 'shrink-0 whitespace-nowrap border-b-2 border-brass px-1 pb-2 text-sm font-medium text-ink'
			: 'shrink-0 whitespace-nowrap border-b-2 border-transparent px-1 pb-2 text-sm text-muted-foreground hover:text-ink';
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title={data.tournament.name} eyebrow="Tournament" />

	<nav class="flex gap-4 overflow-x-auto border-b border-brass/30">
		<a
			href={resolve('/tournaments/[slug]', { slug: data.tournament.slug })}
			class={tabClass(resolve('/tournaments/[slug]', { slug: data.tournament.slug }), true)}
			>Auction</a
		>
		<a
			href={resolve('/tournaments/[slug]/results', { slug: data.tournament.slug })}
			class={tabClass(
				resolve('/tournaments/[slug]/results', { slug: data.tournament.slug }),
				false
			)}>Results</a
		>
		<a
			href={resolve('/tournaments/[slug]/me/bids', { slug: data.tournament.slug })}
			class={tabClass(
				resolve('/tournaments/[slug]/me/bids', { slug: data.tournament.slug }),
				false
			)}>My Bids</a
		>
		<a
			href={resolve('/tournaments/[slug]/me/balance', { slug: data.tournament.slug })}
			class={tabClass(
				resolve('/tournaments/[slug]/me/balance', { slug: data.tournament.slug }),
				false
			)}>My Balance</a
		>
	</nav>

	{@render children()}
</div>
