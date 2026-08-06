<script lang="ts">
	import { onMount } from 'svelte';
	import type { RealtimeBid, RealtimePlayerEntry } from '@emgc-calcutta/shared-types';
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import { currentHighBid } from '$lib/bids';
	import { formatPlayerName } from '$lib/players';
	import { createTournamentRealtime, type RealtimeConnectionStatus } from '$lib/stores/realtime';

	let { data } = $props();

	let liveBids = $state<RealtimeBid[]>([]);
	let liveEntries = $state<RealtimePlayerEntry[]>([]);
	let connectionStatus = $state<RealtimeConnectionStatus>('connecting');

	onMount(() => {
		const rt = createTournamentRealtime(data.supabase, data.tournament.id);
		const unsubBids = rt.bids.subscribe((bids) => (liveBids = bids));
		const unsubEntries = rt.entries.subscribe((entries) => (liveEntries = entries));
		const unsubConnection = rt.connectionStatus.subscribe((s) => (connectionStatus = s));
		return () => {
			unsubBids();
			unsubEntries();
			unsubConnection();
			rt.destroy();
		};
	});

	let players = $derived(
		data.players.map((player) => {
			const live = liveEntries.find((e) => e.id === player.id);
			return live ? { ...player, status: live.status as typeof player.status } : player;
		})
	);

	// Only this user's own non-voided bids — currentHighBid already treats a
	// voided bid as if it never happened, same convention every other bid
	// display in this app follows, so a bid this user voided (or had voided)
	// and never replaced correctly drops the entry off this list entirely.
	let myBids = $derived(liveBids.filter((bid) => bid.bidder_id === data.currentUserId));

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	// "Leading"/"Won" both mean the same thing (my bid is the current high) —
	// only the tense differs, based on whether the entry has actually
	// settled yet. Same for "Outbid"/"Lost". A settled entry with no
	// surviving bid at all (no_bid) can't appear here in the first place —
	// reaching that status means every bid, mine included, ended up voided,
	// which already excludes the entry via myBids above.
	function outcome(status: string, isHigh: boolean): { label: string; variant: BadgeVariant } {
		const settled = status === 'sold_silent' || status === 'sold_live';
		if (isHigh)
			return settled
				? { label: 'Won', variant: 'fairway' }
				: { label: 'Leading', variant: 'fairway' };
		return settled ? { label: 'Lost', variant: 'sand' } : { label: 'Outbid', variant: 'flag' };
	}

	let myBidRows = $derived(
		players.flatMap((player) => {
			const myHigh = currentHighBid(myBids, player.id);
			if (!myHigh) return [];
			const high = currentHighBid(liveBids, player.id);
			return [
				{
					...player,
					myBidAmount: myHigh.amount,
					highBidAmount: high?.amount ?? myHigh.amount,
					isHigh: high?.bidder_id === data.currentUserId
				}
			];
		})
	);
</script>

<div class="flex flex-col gap-4 pt-4">
	<RealtimeStatusBanner status={connectionStatus} />

	{#if myBidRows.length === 0}
		<EmptyState title="You haven't placed any bids in this tournament yet" />
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Player</Table.Head>
					<Table.Head>Your bid</Table.Head>
					<Table.Head>Current high</Table.Head>
					<Table.Head>Status</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each myBidRows as row (row.id)}
					{@const badge = outcome(row.status, row.isHigh)}
					<Table.Row>
						<Table.Cell class="font-medium text-ink">
							<a
								href={resolve('/tournaments/[slug]/players/[playerSlug]', {
									slug: data.tournament.slug,
									playerSlug: row.slug
								})}
								class="hover:underline">{formatPlayerName(row)}</a
							>
							<DivisionBadge division={row.division} />
						</Table.Cell>
						<Table.Cell class="font-data whitespace-nowrap">
							{formatCurrency(row.myBidAmount)}
						</Table.Cell>
						<Table.Cell class="font-data whitespace-nowrap">
							{formatCurrency(row.highBidAmount)}
						</Table.Cell>
						<Table.Cell>
							<Badge variant={badge.variant}>{badge.label}</Badge>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
