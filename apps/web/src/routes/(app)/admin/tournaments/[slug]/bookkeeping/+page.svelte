<script lang="ts">
	// papaparse is CommonJS — a named `unparse` import fails under Vite's
	// SSR module runner ("Named export 'unparse' not found"), confirmed
	// directly by actually loading this page, not just via typecheck
	// (@types/papaparse declares it as a named export, so svelte-check
	// alone doesn't catch this).
	import Papa from 'papaparse';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';
	import { SvelteMap } from 'svelte/reactivity';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { formatPlayerName } from '$lib/players';
	import { formatUserName } from '$lib/profile';
	import { routes } from '$lib/routes';

	let { data } = $props();
	let { supabase, players, payoutGroups, sweptExportRows } = $derived(data);

	// "Who won whom" — a downloadable sheet for an Admin to distribute to
	// participants outside the app, not gated behind results/placements
	// the way the Results page's data implicitly is (this is a pre-event
	// outreach tool, used right after the live auction closes). Built
	// client-side from data this page already fetched, not a new Edge
	// Function or fresh query. `players` (individually sold) and
	// `sweptExportRows` (Phase 20 field-lot players, resolved separately
	// so they never pollute the on-screen "owed to the pot" table above —
	// see that array's own server-side comment) are combined only here,
	// for the export, with a "Sold via" column distinguishing the two: a
	// swept player's own "Winning bid" is deliberately left blank rather
	// than showing the field lot's sale price as if it were their own —
	// the pool sold together, not them individually.
	function exportCsv() {
		const rows = [
			...players.map((p) => ({
				Player: formatPlayerName(p),
				Flight: p.flight,
				Division: p.division,
				'Winning bid': p.winning_bid ? p.winning_bid.amount.toFixed(2) : '',
				'Buyer first name': p.winning_bid?.bidder?.first_name ?? '',
				'Buyer last name': p.winning_bid?.bidder?.last_name ?? '',
				'Buyer email': p.winning_bid?.bidder?.email ?? '',
				'Buyer phone': p.winning_bid?.bidder?.phone ?? '',
				'Sold via': ''
			})),
			...sweptExportRows.map((r) => ({
				Player: formatPlayerName(r),
				Flight: r.flight,
				Division: r.division,
				'Winning bid': '',
				'Buyer first name': r.bidder?.first_name ?? '',
				'Buyer last name': r.bidder?.last_name ?? '',
				'Buyer email': r.bidder?.email ?? '',
				'Buyer phone': r.bidder?.phone ?? '',
				'Sold via': r.fieldLotName
			}))
		];

		const csv = Papa.unparse(rows);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${data.tournament.slug}-winners.csv`;
		link.click();
		URL.revokeObjectURL(url);
	}

	// Groups the flat, already-sold `players` list by winning bidder —
	// mirrors the silent auction board's own flight-grouping pattern
	// (groupPlayersByFlightAndDivision), just keyed by bidder identity
	// instead of flight/division, and computed client-side here rather than
	// via a shared helper since this grouping is specific to this one page.
	// Keyed by bidder id, not name/email — two different bidders could in
	// principle share a display name. `winning_bid`/`.bidder` are typed
	// nullable (they mirror the DB columns' own nullability) but every row
	// here is already status sold_silent/sold_live, which never happens
	// without a winning bid — the `?? 0`/fallback-key handling below is
	// defensive, not an expected path.
	interface BidderGroup {
		key: string;
		name: string;
		bidCount: number;
		totalAmount: number;
		rows: typeof players;
	}
	let bidderGroups = $derived.by(() => {
		const groups = new SvelteMap<string, BidderGroup>();
		for (const player of players) {
			const bidder = player.winning_bid?.bidder;
			const key = bidder?.id ?? `unknown-${player.id}`;
			const amount = player.winning_bid?.amount ?? 0;
			const existing = groups.get(key);
			if (existing) {
				existing.rows.push(player);
				existing.bidCount += 1;
				existing.totalAmount += amount;
				continue;
			}
			groups.set(key, {
				key,
				name: bidder ? (formatUserName(bidder) ?? bidder.email) : 'Unknown bidder',
				bidCount: 1,
				totalAmount: amount,
				rows: [player]
			});
		}
		return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
	});

	// player.status, not bid.phase — an entry's status already records
	// exactly which auction phase it sold in (set alongside winning_bid_id
	// by close_silent_auctions()/close_live_lot() respectively), so this is
	// free rather than needing a separate query field.
	function phaseLabel(status: 'sold_silent' | 'sold_live'): string {
		return status === 'sold_silent' ? 'Silent' : 'Live';
	}

	function roleLabel(role: 'buyer' | 'golfer' | null): string {
		switch (role) {
			case 'buyer':
				return 'Buyer share';
			case 'golfer':
				return 'Bought back by';
			default:
				return '';
		}
	}

	let pendingBidId: string | null = $state(null);
	let pendingPayoutId: string | null = $state(null);
	let errorMessage = $state('');

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	async function markBidPaid(entryId: string) {
		pendingBidId = entryId;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('mark-bid-paid', {
			body: { entryId }
		});

		if (error) {
			errorMessage = 'Failed to mark this bid paid';
			if (error instanceof FunctionsHttpError) {
				const body = await error.context.json().catch(() => null);
				if (body?.error) errorMessage = body.error;
			}
		} else {
			await invalidateAll();
		}

		pendingBidId = null;
	}

	async function markPayoutPaid(payoutId: string) {
		pendingPayoutId = payoutId;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('mark-payout-paid', {
			body: { payoutId }
		});

		if (error) {
			errorMessage = 'Failed to mark this payout paid';
			if (error instanceof FunctionsHttpError) {
				const body = await error.context.json().catch(() => null);
				if (body?.error) errorMessage = body.error;
			}
		} else {
			await invalidateAll();
		}

		pendingPayoutId = null;
	}
</script>

<div class="flex flex-col gap-8 pt-4">
	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	{#if players.length > 0 || sweptExportRows.length > 0}
		<div class="flex justify-end">
			<Button variant="outline" size="sm" onclick={exportCsv}>Export CSV</Button>
		</div>
	{/if}

	<div class="flex flex-col gap-2">
		<h2 class="font-display text-lg font-semibold text-ink">Winning bids — owed to the pot</h2>
		{#if players.length === 0}
			<EmptyState title="No sold players yet" />
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Bidder</Table.Head>
						<Table.Head>Player</Table.Head>
						<Table.Head>Phase</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each bidderGroups as group (group.key)}
						<Table.Row class="bg-sand/20 hover:bg-sand/20">
							<Table.Cell colspan={6} class="text-sm text-fairway">
								{group.name}
								<span class="text-ink/50 text-xs font-data">
									· {group.bidCount}
									{group.bidCount === 1 ? 'bid' : 'bids'} · {formatCurrency(group.totalAmount)}
								</span>
							</Table.Cell>
						</Table.Row>
						{#each group.rows as player (player.id)}
							<Table.Row>
								<Table.Cell />
								<Table.Cell class="font-medium text-ink">
									{formatPlayerName(player)}
									<DivisionBadge division={player.division} />
									{#if player.isField}
										<Badge variant="brass">Field lot</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<Badge variant="outline">{phaseLabel(player.status)}</Badge>
								</Table.Cell>
								<Table.Cell class="font-data whitespace-nowrap">
									{player.winning_bid ? formatCurrency(player.winning_bid.amount) : '—'}
								</Table.Cell>
								<Table.Cell>
									{#if player.buyer_marked_paid_at}
										<Badge variant="fairway">Paid</Badge>
									{:else}
										<Badge variant="sand">Owed</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if !player.buyer_marked_paid_at}
										<Button
											variant="brass"
											size="sm"
											disabled={pendingBidId === player.id}
											onclick={() => markBidPaid(player.id)}
										>
											Mark paid
										</Button>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	<div class="flex flex-col gap-2">
		<h2 class="font-display text-lg font-semibold text-ink">Payouts — owed from the pot</h2>
		{#if payoutGroups.length === 0}
			<EmptyState title="No payouts yet" description="These appear once placements are entered." />
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Placement</Table.Head>
						<Table.Head>Player</Table.Head>
						<Table.Head>Winner</Table.Head>
						<Table.Head>Amount</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each payoutGroups as group (group.entryId)}
						{#if group.rows.length === 1}
							{@const payout = group.rows[0]}
							<Table.Row>
								<Table.Cell class="font-data">{group.placement}</Table.Cell>
								<Table.Cell class="font-medium text-ink">
									{group.player ? formatPlayerName(group.player) : '—'}
									{#if group.player}
										<DivisionBadge division={group.player.division} />
									{/if}
									{#if group.viaField}
										<a
											href={routes.tournamentPlayer(data.tournament.slug, group.viaField.slug)}
											class="block text-xs text-brass hover:underline"
										>
											via {group.viaField.name}
										</a>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if payout.bidder}
										{formatUserName(payout.bidder) ?? payout.bidder.email}
									{:else}
										<span class="text-muted-foreground">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="font-data whitespace-nowrap"
									>{formatCurrency(payout.amount)}</Table.Cell
								>
								<Table.Cell>
									{#if payout.marked_paid_at}
										<Badge variant="fairway">Paid</Badge>
									{:else}
										<Badge variant="sand">Owed</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if !payout.marked_paid_at}
										<Button
											variant="brass"
											size="sm"
											disabled={pendingPayoutId === payout.id}
											onclick={() => markPayoutPaid(payout.id)}
										>
											Mark paid
										</Button>
									{/if}
								</Table.Cell>
							</Table.Row>
						{:else}
							<!-- Split payout (Phase 14: an accepted stake buy-back) — a
							     parent row for the placement/player/total, then one
							     sub-row per recipient rather than presenting the two as
							     unrelated payouts. -->
							<Table.Row class="bg-brass/5">
								<Table.Cell class="font-data">{group.placement}</Table.Cell>
								<Table.Cell class="font-medium text-ink">
									{group.player ? formatPlayerName(group.player) : '—'}
									{#if group.player}
										<DivisionBadge division={group.player.division} />
									{/if}
									{#if group.viaField}
										<a
											href={routes.tournamentPlayer(data.tournament.slug, group.viaField.slug)}
											class="block text-xs text-brass hover:underline"
										>
											via {group.viaField.name}
										</a>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-ink/60">Split — {group.rows.length} recipients</Table.Cell>
								<Table.Cell class="font-data font-medium whitespace-nowrap">
									{formatCurrency(group.totalAmount)}
								</Table.Cell>
								<Table.Cell></Table.Cell>
								<Table.Cell></Table.Cell>
							</Table.Row>
							{#each group.rows as payout (payout.id)}
								<Table.Row>
									<Table.Cell></Table.Cell>
									<Table.Cell class="pl-6 text-sm text-ink/60">{roleLabel(payout.role)}</Table.Cell>
									<Table.Cell>
										{#if payout.bidder}
											{formatUserName(payout.bidder) ?? payout.bidder.email}
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="font-data whitespace-nowrap"
										>{formatCurrency(payout.amount)}</Table.Cell
									>
									<Table.Cell>
										{#if payout.marked_paid_at}
											<Badge variant="fairway">Paid</Badge>
										{:else}
											<Badge variant="sand">Owed</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell>
										{#if !payout.marked_paid_at}
											<Button
												variant="brass"
												size="sm"
												disabled={pendingPayoutId === payout.id}
												onclick={() => markPayoutPaid(payout.id)}
											>
												Mark paid
											</Button>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						{/if}
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
