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
			? 'border-b-2 border-brass px-1 pb-2 text-sm font-medium text-ink'
			: 'border-b-2 border-transparent px-1 pb-2 text-sm text-muted-foreground hover:text-ink';
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title={data.tournament.name} eyebrow="Admin">
		{#snippet actions()}
			<a href={resolve('/admin/tournaments')} class="text-sm text-brass hover:underline"
				>Back to tournaments</a
			>
		{/snippet}
	</PageHeader>

	<nav class="flex gap-4 border-b border-brass/30">
		<a
			href={resolve('/admin/tournaments/[slug]', { slug: data.tournament.slug })}
			class={tabClass(resolve('/admin/tournaments/[slug]', { slug: data.tournament.slug }), true)}
			>Settings</a
		>
		<a
			href={resolve('/admin/tournaments/[slug]/players', { slug: data.tournament.slug })}
			class={tabClass(
				resolve('/admin/tournaments/[slug]/players', { slug: data.tournament.slug }),
				false
			)}>Players</a
		>
	</nav>

	{@render children()}
</div>
