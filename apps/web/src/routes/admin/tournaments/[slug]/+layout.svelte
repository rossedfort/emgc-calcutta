<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import TabNav from '$lib/components/TabNav.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import EnterResultsModal from '$lib/components/EnterResultsModal.svelte';

	let { data, children } = $props();

	let resultsModalOpen = $state(false);

	// The live-auction form lives here (shown on every tab) but its
	// ?/startLiveAuction action only exists on the Settings page's own
	// +page.server.ts — layouts can't declare form actions. An absolute
	// action path is SvelteKit's supported way to target another route's
	// action; the response still updates this page's `page.form` (via
	// $app/state, not a per-component `form` prop layouts don't receive)
	// and triggers the default invalidateAll(), same as if the form lived
	// on that page.
	let settingsPath = $derived(resolve('/admin/tournaments/[slug]', { slug: data.tournament.slug }));

	let silentAuctionEnded = $derived(new Date(data.tournament.silent_auction_end) <= new Date());
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
				exact: true,
				matchPrefix: resolve('/admin/tournaments/[slug]/edit', { slug: data.tournament.slug })
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
	>
		{#snippet trailing()}
			<span class="text-sm text-muted-foreground">Live auction</span>
			{#if data.tournament.live_auction_started_at}
				<Badge variant="fairway">Started</Badge>
				<span class="text-sm text-ink/70">
					{new Date(data.tournament.live_auction_started_at).toLocaleString()}
				</span>
			{:else}
				<form method="POST" action="{settingsPath}?/startLiveAuction" use:enhance>
					<Button type="submit" variant="brass" size="sm" disabled={!silentAuctionEnded}>
						Start live auction
					</Button>
				</form>
			{/if}
		{/snippet}
	</TabNav>
	{#if !data.tournament.live_auction_started_at && !silentAuctionEnded}
		<p class="-mt-2 text-xs text-ink/60">
			Live auction available once the silent auction ends ({new Date(
				data.tournament.silent_auction_end
			).toLocaleString()})
		</p>
	{/if}
	{#if page.form?.liveAuctionError}
		<p class="text-sm text-destructive">{page.form.liveAuctionError}</p>
	{/if}

	{@render children()}
</div>
