<script lang="ts">
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import * as Table from '$lib/components/ui/table';
	import { PLAYER_STATUSES, playerStatusBadgeVariant, playerStatusLabel } from '$lib/players';
	import { groupPlayersByFlight } from '$lib/flightGroups';

	let { data } = $props();

	let statusFilter = $state('all');
	let flightFilter = $state('all');

	let filteredPlayers = $derived(
		data.players.filter((p) => {
			if (statusFilter !== 'all' && p.status !== statusFilter) return false;
			if (flightFilter !== 'all' && p.flight !== flightFilter) return false;
			return true;
		})
	);

	let groupedPlayers = $derived(groupPlayersByFlight(filteredPlayers, data.tournament.flights));
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Players" />
	<p class="font-data text-xs tracking-widest text-fairway uppercase">{data.tournament.name}</p>

	<div class="flex items-center gap-4 text-sm">
		<label class="flex items-center gap-2">
			<span class="text-muted-foreground">Status</span>
			<select
				bind:value={statusFilter}
				class="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
			>
				<option value="all">All</option>
				{#each PLAYER_STATUSES as status (status)}
					<option value={status}>{playerStatusLabel(status)}</option>
				{/each}
			</select>
		</label>
		{#if data.tournament.flights.length > 0}
			<label class="flex items-center gap-2">
				<span class="text-muted-foreground">Flight</span>
				<select
					bind:value={flightFilter}
					class="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
				>
					<option value="all">All</option>
					{#each data.tournament.flights as flight (flight)}
						<option value={flight}>{flight}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>

	{#if filteredPlayers.length === 0}
		<p class="text-sm text-muted-foreground">No players match these filters.</p>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Name</Table.Head>
					<Table.Head>Flight</Table.Head>
					<Table.Head>Status</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each groupedPlayers as { group, players } (group.flight)}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell
							colspan={3}
							class="font-data text-xs tracking-widest text-fairway uppercase"
						>
							{group.label}
						</Table.Cell>
					</Table.Row>
					{#each players as player (player.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">
								<a
									href={resolve('/tournaments/[slug]/players/[playerSlug]', {
										slug: data.tournament.slug,
										playerSlug: player.slug
									})}
									class="hover:underline">{player.name}</a
								>
								<DivisionBadge division={player.division} />
							</Table.Cell>
							<Table.Cell>{player.flight || '—'}</Table.Cell>
							<Table.Cell>
								<Badge variant={playerStatusBadgeVariant(player.status)}>
									{playerStatusLabel(player.status)}
								</Badge>
							</Table.Cell>
						</Table.Row>
					{/each}
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
