<script lang="ts">
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import TableHeaderSelectFilter from '$lib/components/TableHeaderSelectFilter.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import {
		PLAYER_STATUSES,
		formatHandicapIndex,
		formatPlayerName,
		playerStatusBadgeVariant,
		playerStatusLabel
	} from '$lib/players';
	import { groupPlayersByFlight } from '$lib/flightGroups';
	import { routes } from '$lib/routes';

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

	// Counts distinct golfers, not player_entries rows — a Championship-flight
	// golfer has two entries (Gross + Net, see DivisionBadge) that would
	// otherwise double-count them here. Reflects the current filters, same as
	// the table itself, so the counts never disagree with what's on screen.
	function distinctPlayerCount(players: { slug: string }[]): number {
		return new Set(players.map((p) => p.slug)).size;
	}

	let totalPlayerCount = $derived(distinctPlayerCount(filteredPlayers));
</script>

<div class="flex flex-col gap-4 pt-4">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="font-data text-sm text-ink/70">
			{totalPlayerCount}
			{totalPlayerCount === 1 ? 'player' : 'players'}
		</p>

		<div class="flex flex-wrap items-center gap-2">
			<Button
				href={routes.adminTournamentPlayerNew(data.tournament.slug)}
				variant="brass"
				size="sm"
			>
				New player
			</Button>
			<Button
				href={routes.adminTournamentPlayersImport(data.tournament.slug)}
				variant="brass"
				size="sm"
			>
				Import players
			</Button>
			<Button
				href={routes.adminTournamentPlayersExport(data.tournament.slug)}
				variant="outline"
				size="sm"
			>
				Export CSV
			</Button>
		</div>
	</div>

	{#if filteredPlayers.length === 0}
		<EmptyState title="No players match these filters" />
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Name</Table.Head>
					<Table.Head>
						<span class="inline-flex items-center gap-1">
							Flight
							{#if flightOptions.length > 0}
								<TableHeaderSelectFilter
									label="Flight"
									options={flightOptions}
									selected={flightFilters}
									onApply={(values) => (flightFilters = values)}
								/>
							{/if}
						</span>
					</Table.Head>
					<Table.Head>Handicap</Table.Head>
					<Table.Head>
						<span class="inline-flex items-center gap-1">
							Status
							<TableHeaderSelectFilter
								label="Status"
								options={statusOptions}
								selected={statusFilters}
								onApply={(values) => (statusFilters = values)}
							/>
						</span>
					</Table.Head>
					<Table.Head>Linked</Table.Head>
					<Table.Head>Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each groupedPlayers as { group, players } (group.flight)}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell
							colspan={6}
							class="font-data text-xs tracking-widest text-fairway uppercase"
						>
							{group.label}
							<span class="text-ink/50 normal-case">· {distinctPlayerCount(players)}</span>
						</Table.Cell>
					</Table.Row>
					{#each players as player (player.id)}
						<Table.Row>
							<Table.Cell class="font-medium text-ink">
								{formatPlayerName(player)}
								<DivisionBadge division={player.division} />
							</Table.Cell>
							<Table.Cell>{player.flight || '—'}</Table.Cell>
							<Table.Cell class="font-data">{formatHandicapIndex(player.handicap_index)}</Table.Cell
							>
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
									href={routes.adminTournamentPlayerEdit(data.tournament.slug, player.slug)}
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
