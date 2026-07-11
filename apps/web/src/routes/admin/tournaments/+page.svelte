<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';

	let { data } = $props();
	let { tournament } = $derived(data);
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-medium text-foreground">Tournament</h2>
		{#if tournament}
			<Button
				href={resolve('/admin/tournaments/[id]/edit', { id: tournament.id })}
				variant="outline">Edit settings</Button
			>
		{:else}
			<Button href={resolve('/admin/tournaments/new')}>New tournament</Button>
		{/if}
	</div>

	{#if tournament}
		<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="text-muted-foreground">Name</dt>
			<dd>{tournament.name}</dd>
			<dt class="text-muted-foreground">Status</dt>
			<dd>{tournament.status}</dd>
			<dt class="text-muted-foreground">Silent auction window</dt>
			<dd>
				{new Date(tournament.silent_auction_start).toLocaleString()} –
				{new Date(tournament.silent_auction_end).toLocaleString()}
			</dd>
			<dt class="text-muted-foreground">Reservation threshold</dt>
			<dd>${tournament.threshold_amount}</dd>
			<dt class="text-muted-foreground">Minimum bid increment</dt>
			<dd>${tournament.min_increment}</dd>
			<dt class="text-muted-foreground">Anti-snipe window</dt>
			<dd>{tournament.anti_snipe_seconds}s</dd>
			<dt class="text-muted-foreground">Payout structure</dt>
			<dd>
				{#if Object.keys(tournament.payout_structure).length === 0}
					<span class="text-muted-foreground">Not set</span>
				{:else}
					{#each Object.entries(tournament.payout_structure) as [place, percent] (place)}
						<span class="mr-2">#{place}: {percent * 100}%</span>
					{/each}
				{/if}
			</dd>
		</dl>
	{:else}
		<p class="text-sm text-muted-foreground">No tournament has been created yet.</p>
	{/if}
</div>
