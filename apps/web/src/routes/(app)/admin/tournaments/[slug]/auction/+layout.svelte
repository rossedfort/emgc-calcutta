<script lang="ts">
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { page } from '$app/state';
	import TabNav from '$lib/components/TabNav.svelte';
	import { Button } from '$lib/components/ui/button';
	import { routes } from '$lib/routes';

	let { data, children } = $props();

	// TV Display only makes sense from the two operational auction pages
	// themselves — Live bids/Leading bids are review/reporting tabs, not
	// something an Admin casts to a TV mid-auction.
	let tvHref = $derived.by(() => {
		if (page.url.pathname === routes.adminTournamentAuctionLive(data.tournament.slug)) {
			return routes.adminTournamentAuctionLiveTV(data.tournament.slug);
		}
		if (page.url.pathname === routes.adminTournamentAuctionSilent(data.tournament.slug)) {
			return routes.adminTournamentAuctionSilentTV(data.tournament.slug);
		}
		return null;
	});
</script>

<div class="flex flex-col gap-4">
	<TabNav
		size="sub"
		tabs={[
			{
				href: routes.adminTournamentAuctionSilent(data.tournament.slug),
				label: 'Silent auction'
			},
			{
				href: routes.adminTournamentAuctionLive(data.tournament.slug),
				label: 'Live auction'
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
	>
		{#snippet actions()}
			{#if tvHref}
				<Button href={tvHref} target="_blank" variant="ghost" size="xs">
					<ExternalLinkIcon class="size-4" />
					TV Display
				</Button>
			{/if}
		{/snippet}
	</TabNav>

	{@render children()}
</div>
