<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';

	let { data } = $props();
	let { supabase, players, payoutStructure } = $derived(data);

	let draftPlacements: Record<string, string> = $state({});
	let pendingId: string | null = $state(null);
	let errorMessage = $state('');

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function draftValue(playerId: string, currentPlacement: number | null): string {
		return draftPlacements[playerId] ?? (currentPlacement !== null ? String(currentPlacement) : '');
	}

	const payoutEntries = $derived(
		Object.entries(payoutStructure)
			.map(([place, share]) => [Number(place), share] as const)
			.sort((a, b) => a[0] - b[0])
	);

	async function savePlacement(playerId: string) {
		const raw = draftPlacements[playerId];
		const placement = Number(raw);
		if (!raw || !Number.isInteger(placement) || placement <= 0) {
			errorMessage = 'Placement must be a positive whole number';
			return;
		}

		pendingId = playerId;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('set-placement', {
			body: { playerId, placement }
		});

		if (error) {
			errorMessage = 'Failed to set this placement';
			if (error instanceof FunctionsHttpError) {
				const body = await error.context.json().catch(() => null);
				if (body?.error) errorMessage = body.error;
			}
		} else {
			delete draftPlacements[playerId];
			await invalidateAll();
		}

		pendingId = null;
	}
</script>

<div class="flex flex-col gap-4 pt-4">
	{#if payoutEntries.length > 0}
		<p class="text-sm text-muted-foreground">
			Payout structure:
			{#each payoutEntries as [place, share], i (place)}
				{i > 0 ? ', ' : ''}{place}{place === 1
					? 'st'
					: place === 2
						? 'nd'
						: place === 3
							? 'rd'
							: 'th'} = {(share * 100).toFixed(0)}%
			{/each}
		</p>
	{:else}
		<p class="text-sm text-destructive">
			No payout structure configured for this tournament yet — set it on the Settings tab first.
		</p>
	{/if}

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	{#if players.length === 0}
		<p class="text-sm text-muted-foreground">No sold players yet.</p>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Player</Table.Head>
					<Table.Head>Buyer</Table.Head>
					<Table.Head>Winning bid</Table.Head>
					<Table.Head>Placement</Table.Head>
					<Table.Head>Payout</Table.Head>
					<Table.Head>Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each players as player (player.id)}
					<Table.Row>
						<Table.Cell class="font-medium text-ink">{player.name}</Table.Cell>
						<Table.Cell>
							{#if player.winning_bid?.bidder}
								{player.winning_bid.bidder.name ?? player.winning_bid.bidder.email}
							{:else}
								<span class="text-muted-foreground">—</span>
							{/if}
						</Table.Cell>
						<Table.Cell class="font-data">
							{player.winning_bid ? formatCurrency(player.winning_bid.amount) : '—'}
						</Table.Cell>
						<Table.Cell>
							<input
								type="number"
								min="1"
								step="1"
								class="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
								value={draftValue(player.id, player.placement)}
								oninput={(e) => (draftPlacements[player.id] = e.currentTarget.value)}
							/>
						</Table.Cell>
						<Table.Cell class="font-data">
							{#if player.payout}
								{formatCurrency(player.payout.amount)}
								<Badge variant="fairway">{(player.payout.pot_share * 100).toFixed(0)}%</Badge>
							{:else}
								<span class="text-muted-foreground">—</span>
							{/if}
						</Table.Cell>
						<Table.Cell>
							<Button
								variant="brass"
								size="sm"
								disabled={pendingId === player.id}
								onclick={() => savePlacement(player.id)}
							>
								{player.placement !== null ? 'Update' : 'Save'}
							</Button>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
