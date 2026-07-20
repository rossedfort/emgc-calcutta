<script lang="ts">
	import { navigating, page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { AUDIT_ACTIONS, auditActionLabel } from '$lib/auditActions';

	let { data } = $props();

	// Carries whatever filters are currently applied — export reflects the
	// current view, not just the 200 rows shown on screen (the export
	// endpoint itself re-runs the same filtered query uncapped).
	let exportHref = $derived(`${resolve('/admin/audit/export')}${page.url.search}`);

	// The filter form is a plain GET, so re-querying is a real SvelteKit
	// navigation (re-running this route's server `load`) rather than a
	// fetch this component kicks off itself — `navigating` is the only
	// signal available for it. Scoped to "navigating to this same route"
	// so the indicator doesn't flash while leaving the page entirely.
	let isQuerying = $derived(navigating.to?.route.id === page.route.id);

	const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3
	});

	function formatDateTime(iso: string): string {
		return dateTimeFormatter.format(new Date(iso));
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Audit log" eyebrow="Admin">
		{#snippet actions()}
			<Button variant="outline" size="sm" href={exportHref}>Export CSV</Button>
		{/snippet}
	</PageHeader>

	<form
		method="GET"
		class="flex flex-wrap items-end gap-3 rounded-lg border border-brass/30 bg-scorecard p-4"
	>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Actor</span>
			<Input
				type="text"
				name="participant"
				value={data.filters.participant}
				placeholder="Email"
				disabled={isQuerying}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Player</span>
			<Input
				type="text"
				name="player"
				value={data.filters.player}
				placeholder="Name"
				disabled={isQuerying}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Action</span>
			<select
				name="action"
				value={data.filters.action}
				disabled={isQuerying}
				class="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-50"
			>
				<option value="">All</option>
				{#each AUDIT_ACTIONS as action (action)}
					<option value={action}>{auditActionLabel(action)}</option>
				{/each}
			</select>
		</label>
		<div class="flex items-end gap-3">
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-muted-foreground">From</span>
				<Input
					type="datetime-local"
					name="start"
					value={data.filters.start}
					disabled={isQuerying}
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-muted-foreground">To</span>
				<Input type="datetime-local" name="end" value={data.filters.end} disabled={isQuerying} />
			</label>
		</div>
		<Button type="submit" variant="brass" size="sm" disabled={isQuerying}>
			{#if isQuerying}
				<LoaderCircleIcon class="size-3.5 animate-spin" />
			{/if}
			{isQuerying ? 'Applying…' : 'Apply filters'}
		</Button>
		{#if data.filters.participant || data.filters.player || data.filters.action || data.filters.start || data.filters.end}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={isQuerying}
				onclick={() => goto(resolve('/admin/audit'))}
			>
				Clear
			</Button>
		{/if}
	</form>

	{#if data.events.length === 0}
		<EmptyState title="No audit events match these filters" />
	{:else}
		<Table.Root class={isQuerying ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
			<Table.Header>
				<Table.Row>
					<Table.Head class="bg-brass/10">Actor</Table.Head>
					<Table.Head>Time</Table.Head>
					<Table.Head>Action</Table.Head>
					<Table.Head>Entity</Table.Head>
					<Table.Head>Player</Table.Head>
					<Table.Head>Tournament</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.events as event (event.id)}
					<Table.Row>
						<Table.Cell class="bg-brass/10 font-medium text-fairway">
							{event.actor_identity ?? '—'}
						</Table.Cell>
						<Table.Cell class="font-data text-xs text-ink/70">
							<a
								href={resolve('/admin/audit/[id]', { id: event.id })}
								class="text-ink hover:underline"
							>
								{formatDateTime(event.created_at)}
							</a>
						</Table.Cell>
						<Table.Cell class="font-data text-xs">{event.action}</Table.Cell>
						<Table.Cell>{event.entity_type}</Table.Cell>
						<Table.Cell>{event.player_name ?? '—'}</Table.Cell>
						<Table.Cell>{event.tournament_name ?? '—'}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
		{#if data.events.length === 200}
			<p class="text-xs text-muted-foreground">
				Showing the 200 most recent matching events — narrow the filters to see older ones.
			</p>
		{/if}
	{/if}
</div>
