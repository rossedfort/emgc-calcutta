<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '../PageHeader.svelte';
	import type { Tournament } from './shared';

	let { data } = $props();
	let { tournament } = $derived(data);

	function statusBadgeVariant(status: Tournament['status']): BadgeVariant {
		switch (status) {
			case 'active':
				return 'fairway';
			case 'complete':
				return 'outline';
			default:
				return 'sand';
		}
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Tournament">
		{#snippet actions()}
			{#if tournament}
				<Button
					href={resolve('/admin/tournaments/[id]/edit', { id: tournament.id })}
					variant="brass">Edit settings</Button
				>
			{:else}
				<Button href={resolve('/admin/tournaments/new')} variant="brass">New tournament</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if tournament}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
			<div class="flex items-center justify-between gap-4">
				<h3 class="font-display text-xl font-semibold text-ink">{tournament.name}</h3>
				<Badge variant={statusBadgeVariant(tournament.status)}>{tournament.status}</Badge>
			</div>

			<div class="mt-4 border-t border-brass/40"></div>

			<div
				class="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-brass/40 bg-brass/40 sm:grid-cols-3"
			>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Window</span>
					<span class="font-data text-sm text-ink">
						{new Date(tournament.silent_auction_start).toLocaleDateString()} –
						{new Date(tournament.silent_auction_end).toLocaleDateString()}
					</span>
				</div>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase"
						>Threshold</span
					>
					<span class="font-data text-sm text-ink">${tournament.threshold_amount}</span>
				</div>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase"
						>Min increment</span
					>
					<span class="font-data text-sm text-ink">${tournament.min_increment}</span>
				</div>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Snipe</span>
					<span class="font-data text-sm text-ink">{tournament.anti_snipe_seconds}s</span>
				</div>
				<div class="col-span-2 flex flex-col gap-1 bg-scorecard p-3 sm:col-span-1">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Payout</span>
					<span class="font-data text-sm text-ink">
						{#if Object.keys(tournament.payout_structure).length === 0}
							<span class="text-ink/50">Not set</span>
						{:else}
							{#each Object.entries(tournament.payout_structure) as [place, percent] (place)}
								<span class="mr-2">#{place} {percent * 100}%</span>
							{/each}
						{/if}
					</span>
				</div>
			</div>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">No tournament has been created yet.</p>
	{/if}
</div>
