<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { statusBadgeVariant, type Tournament } from './shared';

	let { data } = $props();
	let { tournaments } = $derived(data);

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
			<Button href={resolve('/admin/tournaments/new')} variant="brass">New tournament</Button>
		{/snippet}
	</PageHeader>

	{#if tournaments.length === 0}
		<p class="text-sm text-muted-foreground">No tournaments have been created yet.</p>
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
						<Table.Cell class="font-medium text-ink">{tournament.name}</Table.Cell>
						<Table.Cell>
							<Badge variant={kindBadgeVariant(tournament.kind)}>
								{tournament.kind === 'dry_run' ? 'dry run' : 'production'}
							</Badge>
						</Table.Cell>
						<Table.Cell>
							<Badge variant={statusBadgeVariant(tournament.status)}>{tournament.status}</Badge>
						</Table.Cell>
						<Table.Cell class="font-data text-sm">
							{formatWindow(tournament.silent_auction_start, tournament.silent_auction_end)}
						</Table.Cell>
						<Table.Cell>
							<Button
								href={resolve('/admin/tournaments/[slug]', { slug: tournament.slug })}
								variant="brass"
								size="sm"
							>
								Manage
							</Button>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
