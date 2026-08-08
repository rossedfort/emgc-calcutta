<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import TabNav from '$lib/components/TabNav.svelte';
	import { Button } from '$lib/components/ui/button';
	import EnterResultsModal from '$lib/components/EnterResultsModal.svelte';

	let { data, children } = $props();

	let resultsModalOpen = $state(false);
</script>

<div class="flex flex-col gap-4">
	<PageHeader title={data.tournament.name} eyebrow="Admin">
		{#snippet actions()}
			<a href={resolve('/admin/tournaments')} class="text-sm text-brass hover:underline"
				>Back to tournaments</a
			>
			<Button variant="brass" size="sm" onclick={() => (resultsModalOpen = true)}
				>Enter results</Button
			>
		{/snippet}
	</PageHeader>

	<EnterResultsModal
		bind:open={resultsModalOpen}
		supabase={data.supabase}
		tournamentId={data.tournament.id}
		flights={data.tournament.flights}
		championshipFlight={data.tournament.championship_flight}
		payoutStructure={data.tournament.payout_structure}
		onSuccess={() => invalidateAll()}
	/>

	<TabNav
		tabs={[
			{
				href: resolve('/admin/tournaments/[slug]', { slug: data.tournament.slug }),
				label: 'Settings',
				exact: true
			},
			{
				href: resolve('/admin/tournaments/[slug]/players', { slug: data.tournament.slug }),
				label: 'Players'
			},
			{
				href: resolve('/admin/tournaments/[slug]/auction/queue', { slug: data.tournament.slug }),
				label: 'Auction',
				match: `/admin/tournaments/${data.tournament.slug}/auction`
			},
			{
				href: resolve('/admin/tournaments/[slug]/results', { slug: data.tournament.slug }),
				label: 'Results'
			},
			{
				href: resolve('/admin/tournaments/[slug]/bookkeeping', { slug: data.tournament.slug }),
				label: 'Bookkeeping'
			}
		]}
	/>

	{@render children()}
</div>
