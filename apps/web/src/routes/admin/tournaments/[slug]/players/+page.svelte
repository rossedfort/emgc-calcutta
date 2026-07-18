<script lang="ts">
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import MultiSelectFilter from '$lib/components/MultiSelectFilter.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { PLAYER_STATUSES, playerStatusBadgeVariant, playerStatusLabel } from '$lib/players';
	import { groupPlayersByFlight } from '$lib/flightGroups';

	let { data } = $props();

	let statusFilters = $state<string[]>([]);
	let flightFilters = $state<string[]>([]);

	let statusOptions = $derived(
		PLAYER_STATUSES.map((status) => ({ value: status, label: playerStatusLabel(status) }))
	);
	let flightOptions = $derived(
		data.tournament.flights.map((flight) => ({ value: flight, label: flight }))
	);

	let filteredPlayers = $derived(
		data.players.filter((p) => {
			if (statusFilters.length > 0 && !statusFilters.includes(p.status)) return false;
			if (flightFilters.length > 0 && !flightFilters.includes(p.flight)) return false;
			return true;
		})
	);

	let groupedPlayers = $derived(groupPlayersByFlight(filteredPlayers, data.tournament.flights));
</script>

<div class="flex flex-col gap-4 pt-4">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-4 text-sm">
			<MultiSelectFilter label="Status" options={statusOptions} bind:selected={statusFilters} />
			{#if flightOptions.length > 0}
				<MultiSelectFilter label="Flight" options={flightOptions} bind:selected={flightFilters} />
			{/if}
		</div>

		<div class="flex items-center gap-2">
			<Button
				href={resolve('/admin/tournaments/[slug]/players/new', { slug: data.tournament.slug })}
				variant="brass"
				size="sm"
			>
				New player
			</Button>
			<Button
				href={resolve('/admin/tournaments/[slug]/players/import', { slug: data.tournament.slug })}
				variant="brass"
				size="sm"
			>
				Import players
			</Button>
		</div>
	</div>

	{#if filteredPlayers.length === 0}
		<p class="text-sm text-muted-foreground">No players match these filters.</p>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Name</Table.Head>
					<Table.Head>Handicap</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head>Linked</Table.Head>
					<Table.Head>Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each groupedPlayers as { group, players } (group.flight)}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell
							colspan={5}
							class="font-data text-xs tracking-widest text-fairway uppercase"
						>
							{group.label}
						</Table.Cell>
					</Table.Row>
					{#each players as player (player.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">
								{player.name}
								<DivisionBadge division={player.division} />
							</Table.Cell>
							<Table.Cell class="font-data">{player.handicap_index ?? '—'}</Table.Cell>
							<Table.Cell>
								<Badge variant={playerStatusBadgeVariant(player.status)}>
									{playerStatusLabel(player.status)}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								{#if player.user_id}
									<Badge variant="fairway">Linked</Badge>
								{:else}
									<span class="text-muted-foreground">—</span>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<Button
									href={resolve('/admin/tournaments/[slug]/players/[playerSlug]/edit', {
										slug: data.tournament.slug,
										playerSlug: player.slug
									})}
									variant="brass"
									size="sm"
								>
									Edit
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
