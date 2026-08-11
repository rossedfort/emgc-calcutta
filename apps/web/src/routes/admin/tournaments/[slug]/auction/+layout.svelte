<script lang="ts">
	import { resolve } from '$app/paths';
	import TabNav from '$lib/components/TabNav.svelte';

	let { data, children } = $props();
</script>

<div class="flex flex-col gap-4">
	<TabNav
		size="sub"
		tabs={[
			{
				href: resolve('/admin/tournaments/[slug]/auction/live', { slug: data.tournament.slug }),
				label: 'Live auction'
			},
			{
				href: resolve('/admin/tournaments/[slug]/auction/silent', { slug: data.tournament.slug }),
				label: 'Silent auction bids'
			}
		]}
	/>

	{@render children()}
</div>
