<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import DeleteTournamentDialog from '$lib/components/DeleteTournamentDialog.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { routes } from '$lib/routes';
	import { statusBadgeVariant, type Tournament } from './shared';

	let { data } = $props();
	let { tournaments, supabase } = $derived(data);

	let deleteDialogOpen = $state(false);
	let tournamentToDelete = $state<Tournament | null>(null);

	function openDeleteDialog(tournament: Tournament) {
		tournamentToDelete = tournament;
		deleteDialogOpen = true;
	}

	function kindBadgeVariant(kind: Tournament['kind']): BadgeVariant {
		return kind === 'dry_run' ? 'brass' : 'outline';
	}

	function formatWindow(startIso: string, endIso: string): string {
		const start = new Date(startIso).toLocaleDateString();
		const end = new Date(endIso).toLocaleDateString();
		return `${start} – ${end}`;
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Tournaments" eyebrow="Admin">
		{#snippet actions()}
			<Button href={routes.adminTournamentNew()} variant="brass">New tournament</Button>
		{/snippet}
	</PageHeader>

	{#if tournaments.length === 0}
		<EmptyState title="No tournaments have been created yet">
			{#snippet actions()}
				<Button href={routes.adminTournamentNew()} variant="brass" size="sm">New tournament</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Name</Table.Head>
					<Table.Head>Kind</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head>Window</Table.Head>
					<Table.Head>Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each tournaments as tournament (tournament.id)}
					<Table.Row>
						<Table.Cell class="font-medium text-ink">
							<a class="underline underline-offset-2" href={routes.adminTournament(tournament.slug)}
								>{tournament.name}</a
							>
						</Table.Cell>
						<Table.Cell class="whitespace-nowrap">
							<Badge variant={kindBadgeVariant(tournament.kind)}>
								{tournament.kind === 'dry_run' ? 'dry run' : 'production'}
							</Badge>
						</Table.Cell>
						<Table.Cell class="whitespace-nowrap">
							<Badge variant={statusBadgeVariant(tournament.status)}>{tournament.status}</Badge>
						</Table.Cell>
						<Table.Cell class="font-data text-sm whitespace-nowrap">
							{formatWindow(tournament.silent_auction_start, tournament.silent_auction_end)}
						</Table.Cell>
						<Table.Cell class="flex flex-wrap items-center gap-2 whitespace-nowrap">
							<Button href={routes.adminTournament(tournament.slug)} variant="brass" size="sm">
								Manage
							</Button>
							{#if tournament.kind === 'dry_run'}
								<Button
									variant="destructive"
									size="sm"
									onclick={() => openDeleteDialog(tournament)}
								>
									Delete
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>

{#if tournamentToDelete}
	<DeleteTournamentDialog
		bind:open={deleteDialogOpen}
		{supabase}
		tournamentId={tournamentToDelete.id}
		tournamentName={tournamentToDelete.name}
		onSuccess={() => invalidateAll()}
	/>
{/if}
