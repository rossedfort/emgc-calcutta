<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { statusBadgeVariant, type Tournament } from '../shared';

	let { data, form } = $props();

	const statuses: Tournament['status'][] = ['setup', 'active', 'complete'];

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function formatPercent(fraction: number): string {
		return `${Math.round(fraction * 100)}%`;
	}

	let payoutPlaces = $derived(
		Object.entries(data.tournament.payout_structure).sort(([a], [b]) => Number(a) - Number(b))
	);
</script>

{#snippet sectionHeading(text: string)}
	<h3 class="font-data text-xs tracking-widest text-fairway uppercase">{text}</h3>
{/snippet}

<div class="flex max-w-3xl flex-col gap-4 pt-4">
	<div class="flex flex-col gap-2">
		<div class="flex items-center gap-2">
			<span class="text-sm text-muted-foreground">Status</span>
			{#each statuses as status (status)}
				{#if status === data.tournament.status}
					<Badge variant={statusBadgeVariant(status)}>{status}</Badge>
				{:else}
					<form method="POST" action="?/setStatus" use:enhance>
						<input type="hidden" name="status" value={status} />
						<Button type="submit" variant="brass" size="sm">Mark {status}</Button>
					</form>
				{/if}
			{/each}
		</div>
		{#if form?.statusError}
			<p class="text-sm text-destructive">{form.statusError}</p>
		{/if}
	</div>

	<div class="flex flex-col gap-8 border-t border-brass/20 pt-6">
		<div class="flex items-center justify-between">
			<h2 class="font-display text-lg font-semibold text-ink">Tournament configuration</h2>
			<Button
				href={resolve('/admin/tournaments/[slug]/edit', { slug: data.tournament.slug })}
				variant="brass"
				size="sm"
			>
				Edit
			</Button>
		</div>

		<div class="flex flex-col gap-4">
			{@render sectionHeading('Basics')}
			<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
				<dt class="text-ink/60">Name</dt>
				<dd>{data.tournament.name}</dd>
				<dt class="text-ink/60">Type</dt>
				<dd>{data.tournament.kind === 'dry_run' ? 'Dry run' : 'Production'}</dd>
			</dl>
		</div>

		<div class="flex flex-col gap-4 border-t border-brass/20 pt-6">
			{@render sectionHeading('Auction settings')}
			<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
				<dt class="text-ink/60">Silent auction start</dt>
				<dd class="font-data">
					{new Date(data.tournament.silent_auction_start).toLocaleString()}
				</dd>
				<dt class="text-ink/60">Silent auction end</dt>
				<dd class="font-data">{new Date(data.tournament.silent_auction_end).toLocaleString()}</dd>
				<dt class="text-ink/60">Reservation threshold</dt>
				<dd class="font-data">{formatCurrency(data.tournament.threshold_amount)}</dd>
				<dt class="text-ink/60">Minimum bid increment</dt>
				<dd class="font-data">{formatCurrency(data.tournament.min_increment)}</dd>
				<dt class="text-ink/60">Minimum opening bid</dt>
				<dd class="font-data">{formatCurrency(data.tournament.minimum_bid)}</dd>
				<dt class="text-ink/60">Anti-snipe window</dt>
				<dd class="font-data">{data.tournament.anti_snipe_seconds}s</dd>
				<dt class="text-ink/60">Hide bidder names</dt>
				<dd>{data.tournament.bid_anonymity_enabled ? 'Yes' : 'No'}</dd>
			</dl>
		</div>

		<div class="flex flex-col gap-4 border-t border-brass/20 pt-6">
			{@render sectionHeading('Buy-back')}
			<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
				<dt class="text-ink/60">Buy-back percentage</dt>
				<dd>
					{data.tournament.buy_back_percentage !== null
						? formatPercent(data.tournament.buy_back_percentage)
						: 'Not enabled'}
				</dd>
				<dt class="text-ink/60">Tournament start</dt>
				<dd class="font-data">
					{data.tournament.event_start_at
						? new Date(data.tournament.event_start_at).toLocaleString()
						: 'No cutoff'}
				</dd>
			</dl>
		</div>

		<div class="flex flex-col gap-4 border-t border-brass/20 pt-6">
			{@render sectionHeading('Flights')}
			{#if data.tournament.flights.length > 0}
				<ol class="flex flex-col gap-1 text-sm">
					{#each data.tournament.flights as flight (flight)}
						<li>
							{flight}
							{#if flight === data.tournament.championship_flight}
								<Badge variant="brass" class="ml-2">Championship</Badge>
							{/if}
						</li>
					{/each}
				</ol>
			{:else}
				<p class="text-sm text-muted-foreground">
					No flights configured — every player is in one group.
				</p>
			{/if}
		</div>

		<div class="flex flex-col gap-4 border-t border-brass/20 pt-6">
			{@render sectionHeading('Payout structure')}
			{#if payoutPlaces.length > 0}
				<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
					{#each payoutPlaces as [place, percent] (place)}
						<dt class="text-ink/60">Place {place}</dt>
						<dd class="font-data">{formatPercent(percent)}</dd>
					{/each}
				</dl>
			{:else}
				<p class="text-sm text-muted-foreground">
					Not configured yet — can be finalized before results are entered.
				</p>
			{/if}
		</div>
	</div>
</div>
