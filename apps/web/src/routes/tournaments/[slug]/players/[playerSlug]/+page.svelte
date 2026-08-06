<script lang="ts">
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import {
		formatHandicapIndex,
		formatPlayerName,
		playerStatusBadgeVariant,
		playerStatusLabel
	} from '$lib/players';

	let { data } = $props();

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function formatDateTime(iso: string): string {
		return dateTimeFormatter.format(new Date(iso));
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title={formatPlayerName(data.player)}>
		{#snippet actions()}
			<a
				href={resolve('/tournaments/[slug]', { slug: data.tournament.slug })}
				class="text-sm text-brass hover:underline">Back to players</a
			>
		{/snippet}
	</PageHeader>

	<p class="font-data text-xs tracking-widest text-fairway uppercase">{data.tournament.name}</p>

	<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
		<div class="flex items-center gap-2">
			{#if data.isYou}
				<Badge variant="brass">This is you</Badge>
			{:else if data.player.user_id}
				<Badge variant="fairway">
					Linked{data.linkedUserName ? ` · ${data.linkedUserName}` : ' to a participant'}
				</Badge>
			{/if}
		</div>

		<div class="mt-4 border-t border-brass/40"></div>

		{#if data.player.is_field}
			<p class="text-sm text-ink/70">
				A pooled lot — every player below drew zero silent-auction bids and was pooled together here
				instead. Whoever wins this lot collects the payout for any of them who finishes in a paid
				placement.
			</p>
			<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
				<dt class="text-ink/60">Flight</dt>
				<dd>{data.player.flight || '—'}</dd>
			</dl>

			<div class="mt-4 flex flex-col gap-2">
				<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
					Players in this lot
				</p>
				{#if data.pooledPlayers.length === 0}
					<p class="text-sm text-ink/70">No players pooled here yet.</p>
				{:else}
					<ul class="flex flex-col gap-1 text-sm">
						{#each data.pooledPlayers as pooled (pooled.slug)}
							<li>
								<a
									href={resolve('/tournaments/[slug]/players/[playerSlug]', {
										slug: data.tournament.slug,
										playerSlug: pooled.slug
									})}
									class="text-ink hover:underline">{formatPlayerName(pooled)}</a
								>
								<span class="text-ink/60">
									{[
										pooled.flight ? `Flight ${pooled.flight}` : null,
										pooled.handicap_index !== null
											? `HCP ${formatHandicapIndex(pooled.handicap_index)}`
											: null
									]
										.filter(Boolean)
										.join(' · ')}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{:else}
			<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
				<dt class="text-ink/60">Flight</dt>
				<dd>{data.player.flight || '—'}</dd>
				<dt class="text-ink/60">Handicap</dt>
				<dd class="font-data">{formatHandicapIndex(data.player.handicap_index)}</dd>
				<dt class="text-ink/60">Preferences</dt>
				<dd>{data.player.preferences ?? '—'}</dd>
			</dl>
		{/if}
	</div>

	<!-- One section per entry (Phase 11) — a Championship golfer has two
	     (Gross and Net), each with its own status and bid history, shown as
	     separate sections on this one profile page instead of two entirely
	     separate pages. -->
	{#each data.entries as entry (entry.id)}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
			<div class="flex items-center gap-2">
				<DivisionBadge division={entry.division} />
				<Badge variant={playerStatusBadgeVariant(entry.status)}>
					{playerStatusLabel(entry.status)}
				</Badge>
				{#if entry.fieldEntry}
					<a
						href={resolve('/tournaments/[slug]/players/[playerSlug]', {
							slug: data.tournament.slug,
							playerSlug: entry.fieldEntry.slug
						})}
						class="text-sm text-brass hover:underline">See {entry.fieldEntry.name} →</a
					>
				{/if}
			</div>

			<div class="mt-4 border-t border-brass/40"></div>

			<div class="mt-4 flex flex-col gap-2">
				<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Bid history</p>
				{#if entry.bids.length === 0}
					<p class="text-sm text-ink/70">No bids placed yet.</p>
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Amount</Table.Head>
								<Table.Head>Placed</Table.Head>
								<Table.Head>Status</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each entry.bids as bid (bid.id)}
								<Table.Row>
									<Table.Cell class="font-data whitespace-nowrap"
										>{formatCurrency(bid.amount)}</Table.Cell
									>
									<Table.Cell class="font-data whitespace-nowrap"
										>{formatDateTime(bid.placed_at)}</Table.Cell
									>
									<Table.Cell>
										{#if bid.voided_at}
											<Badge variant="flag">Voided</Badge>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</div>
		</div>
	{/each}
</div>
