<script lang="ts">
	import TabNav from '$lib/components/TabNav.svelte';
	import { routes } from '$lib/routes';

	let { data, children } = $props();
</script>

<div class="flex flex-col gap-4">
	<TabNav
		size="sub"
		tabs={[
			{
				href: routes.adminTournamentAuctionLive(data.tournament.slug),
				label: 'Live auction'
			},
			{
				href: routes.adminTournamentAuctionSilent(data.tournament.slug),
				label: 'Silent bids'
			},
			{
				href: routes.adminTournamentAuctionLiveBids(data.tournament.slug),
				label: 'Live bids'
			},
			{
				href: routes.adminTournamentAuctionLeadingBids(data.tournament.slug),
				label: 'Leading bids'
			}
		]}
	/>

	{@render children()}
</div>
