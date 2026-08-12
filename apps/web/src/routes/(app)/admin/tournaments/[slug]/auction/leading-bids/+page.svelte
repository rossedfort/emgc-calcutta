<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import { formatPlayerName, playerStatusBadgeVariant, playerStatusLabel } from '$lib/players';
	import { formatUserName } from '$lib/profile';
	import type { LeadingBidRow } from './+page.server';

	let { data } = $props();

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function phaseLabel(phase: 'silent' | 'live'): string {
		return phase === 'silent' ? 'Silent' : 'Live';
	}

	// Grouped by bidder, same pattern (and same reasoning: this is what a
	// bidder would owe if every one of their leading bids held) as the
	// bookkeeping page's own bidder grouping — the only difference is these
	// totals are provisional, not owed, since any of these bids can still be
	// beaten.
	interface BidderGroup {
		key: string;
		name: string;
		bidCount: number;
		totalAmount: number;
		rows: LeadingBidRow[];
	}
	let bidderGroups = $derived.by(() => {
		const groups = new SvelteMap<string, BidderGroup>();
		for (const row of data.leadingBids) {
			const key = row.bidder?.id ?? `unknown-${row.id}`;
			const existing = groups.get(key);
			if (existing) {
				existing.rows.push(row);
				existing.bidCount += 1;
				existing.totalAmount += row.amount;
				continue;
			}
			groups.set(key, {
				key,
				name: row.bidder ? (formatUserName(row.bidder) ?? row.bidder.email) : 'Unknown bidder',
				bidCount: 1,
				totalAmount: row.amount,
				rows: [row]
			});
		}
		return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
	});
</script>

<div class="flex flex-col gap-4 pt-4">
	<div class="flex flex-col gap-2">
		<h2 class="font-display text-lg font-semibold text-ink">Leading bids</h2>
		<p class="text-sm text-ink/60">
			Entries with a current standing bid that haven't sold yet, grouped by bidder — still subject
			to being outbid, not owed to the pot.
		</p>
	</div>

	{#if data.leadingBids.length === 0}
		<EmptyState title="No leading bids" description="No entry currently has an unsold bid." />
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Bidder</Table.Head>
					<Table.Head>Player</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head>Phase</Table.Head>
					<Table.Head>Current bid</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each bidderGroups as group (group.key)}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell colspan={5} class="text-sm text-fairway">
							{group.name}
							<span class="text-ink/50 text-xs font-data">
								· {group.bidCount}
								{group.bidCount === 1 ? 'bid' : 'bids'} · {formatCurrency(group.totalAmount)} if all held
							</span>
						</Table.Cell>
					</Table.Row>
					{#each group.rows as row (row.id)}
						<Table.Row>
							<Table.Cell />
							<Table.Cell class="font-medium text-ink">
								{formatPlayerName(row)}
								<DivisionBadge division={row.division} />
								{#if row.isField}
									<Badge variant="brass">Field lot</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<Badge variant={playerStatusBadgeVariant(row.status)}>
									{playerStatusLabel(row.status)}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								<Badge variant="outline">{phaseLabel(row.phase)}</Badge>
							</Table.Cell>
							<Table.Cell class="font-data whitespace-nowrap">
								{formatCurrency(row.amount)}
							</Table.Cell>
						</Table.Row>
					{/each}
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
