<script lang="ts">
	import type {
		ImportCsvConfirmResponse,
		ImportCsvPreviewFieldChange,
		ImportCsvPreviewResponse
	} from '@emgc-calcutta/shared-types';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { formatHandicapIndex } from '$lib/players';

	let { data, form } = $props();

	let step = $state<'upload' | 'preview' | 'done'>('upload');
	let previewData = $state<ImportCsvPreviewResponse | null>(null);
	let importResult = $state<ImportCsvConfirmResponse | null>(null);

	// Per-row checkbox state, seeded whenever a new preview payload arrives —
	// error rows and unchanged rows start unchecked (nothing to submit for
	// either — an error can't be imported until the CSV is fixed, and an
	// unchanged row has no edit to apply).
	let included = $state<Record<number, boolean>>({});

	$effect(() => {
		if (form && 'step' in form) {
			if (form.step === 'preview' && 'preview' in form) {
				// Read from `form.preview` (a local, not the `previewData` state
				// this effect also writes) — reading the state var back inside the
				// same effect that assigns it re-triggers the effect on its own
				// write, causing an infinite loop (effect_update_depth_exceeded).
				const nextPreview = form.preview as ImportCsvPreviewResponse;
				const nextIncluded: Record<number, boolean> = {};
				for (const row of nextPreview.rows) {
					nextIncluded[row.rowNumber] = row.errors.length === 0 && row.changeType !== 'unchanged';
				}
				previewData = nextPreview;
				included = nextIncluded;
				step = 'preview';
			} else if (form.step === 'done' && 'imported' in form) {
				importResult = form.imported as ImportCsvConfirmResponse;
				step = 'done';
			}
		}
	});

	let errorMessage = $derived(form && 'error' in form ? (form.error as string) : null);

	let addingRows = $derived((previewData?.rows ?? []).filter((row) => row.changeType === 'add'));
	let updatingRows = $derived(
		(previewData?.rows ?? []).filter((row) => row.changeType === 'update')
	);

	let includedCount = $derived(Object.values(included).filter(Boolean).length);
	let addIncludedCount = $derived(addingRows.filter((row) => included[row.rowNumber]).length);
	let updateIncludedCount = $derived(updatingRows.filter((row) => included[row.rowNumber]).length);

	// A Championship-flight row becomes two player_entries rows on confirm
	// (one players row either way) — this is the actual number of sellable
	// entries a batch of *adds* will create, not just the number of CSV
	// lines selected. Not tracked for updates — a flight edit that crosses
	// the Championship boundary is already called out per-row via its own
	// "Flight: … →" change line, so a second aggregate count would be
	// redundant there.
	let addEntryCount = $derived(
		addingRows
			.filter((row) => included[row.rowNumber])
			.reduce((sum, row) => sum + (isChampionshipRow(row.flight) ? 2 : 1), 0)
	);

	let confirmRows = $derived(
		JSON.stringify(
			(previewData?.rows ?? [])
				.filter((row) => included[row.rowNumber])
				.map((row) => ({
					...(row.id ? { id: row.id } : {}),
					first_name: row.first_name,
					last_name: row.last_name,
					flight: row.flight,
					handicap_index: row.handicap_index,
					preferences: row.preferences,
					photo_url: row.photo_url
				}))
		)
	);

	function cancelPreview() {
		step = 'upload';
		previewData = null;
	}

	// A row whose flight is the tournament's Championship flight becomes two
	// player_entries rows on confirm (Gross + Net) — flagged here so the
	// preview isn't a silent surprise about the eventual entry count.
	function isChampionshipRow(flight: string | null): boolean {
		return !!data.tournament.championship_flight && flight === data.tournament.championship_flight;
	}

	const FIELD_LABELS: Record<ImportCsvPreviewFieldChange['field'], string> = {
		first_name: 'First name',
		last_name: 'Last name',
		flight: 'Flight',
		handicap_index: 'Handicap',
		preferences: 'Preferences',
		photo_url: 'Photo URL'
	};

	function formatChangeValue(value: string | number | null): string {
		return value === null || value === '' ? '—' : String(value);
	}

	function formatChanges(changes: ImportCsvPreviewFieldChange[]): string {
		return changes
			.map(
				(c) =>
					`${FIELD_LABELS[c.field]}: ${formatChangeValue(c.before)} → ${formatChangeValue(c.after)}`
			)
			.join(', ');
	}

	let previewSubmitting = $state(false);
	let confirmSubmitting = $state(false);
</script>

<div class="flex flex-col gap-4 pt-4">
	<PageHeader title="Import players">
		{#snippet actions()}
			<a
				href={resolve('/admin/tournaments/[slug]/players', { slug: data.tournament.slug })}
				class="text-sm text-brass hover:underline">Back to players</a
			>
		{/snippet}
	</PageHeader>

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	{#if step === 'done' && importResult}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
			<p class="font-display text-xl font-semibold text-ink">
				{#if importResult.addedCount > 0 && importResult.updatedCount > 0}
					{importResult.addedCount} added, {importResult.updatedCount} updated
				{:else if importResult.updatedCount > 0}
					{importResult.updatedCount}
					{importResult.updatedCount === 1 ? 'player' : 'players'} updated
				{:else}
					{importResult.addedCount}
					{importResult.addedCount === 1 ? 'player' : 'players'} added to the roster
				{/if}
			</p>
			{#if importResult.rowErrors.length > 0}
				<div class="mt-3 text-sm text-destructive">
					<p>
						{importResult.rowErrors.length}
						{importResult.rowErrors.length === 1 ? 'row' : 'rows'} couldn't be applied:
					</p>
					<ul class="mt-1 list-inside list-disc">
						{#each importResult.rowErrors as rowError (rowError.id)}
							<li>{rowError.error}</li>
						{/each}
					</ul>
				</div>
			{/if}
			<div class="mt-4">
				<Button
					href={resolve('/admin/tournaments/[slug]/players', { slug: data.tournament.slug })}
					variant="brass">Back to players</Button
				>
			</div>
		</div>
	{:else if step === 'preview' && previewData}
		<div class="flex flex-wrap items-center gap-4 text-sm">
			<span class="font-data flex items-center gap-2">
				<span class="size-1.5 rounded-full bg-fairway"></span>
				{previewData.addCount}
				{previewData.addCount === 1 ? 'player' : 'players'} to add
			</span>
			<span class="font-data flex items-center gap-2">
				<span class="size-1.5 rounded-full bg-brass"></span>
				{previewData.updateCount}
				{previewData.updateCount === 1 ? 'change' : 'changes'} to apply
			</span>
			{#if previewData.unchangedCount > 0}
				<span class="font-data text-ink/50">{previewData.unchangedCount} unchanged</span>
			{/if}
			{#if previewData.errorCount > 0}
				<span class="font-data flex items-center gap-2 text-flag">
					<span class="size-1.5 rounded-full bg-flag"></span>
					{previewData.errorCount}
					{previewData.errorCount === 1 ? 'row needs' : 'rows need'} attention
				</span>
			{/if}
		</div>

		{#if updatingRows.length > 0}
			<div class="flex flex-col gap-2">
				<p class="font-data text-xs tracking-widest text-fairway uppercase">Updating</p>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Include</Table.Head>
							<Table.Head>Name</Table.Head>
							<Table.Head>Changes</Table.Head>
							<Table.Head>Notes</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each updatingRows as row (row.rowNumber)}
							<Table.Row class={row.errors.length > 0 ? 'bg-flag/5' : ''}>
								<Table.Cell>
									<input
										type="checkbox"
										class="accent-brass"
										aria-label="Include {[row.first_name, row.last_name]
											.filter(Boolean)
											.join(' ') || `row ${row.rowNumber}`}"
										disabled={row.errors.length > 0}
										checked={included[row.rowNumber] ?? false}
										onchange={(e) => (included[row.rowNumber] = e.currentTarget.checked)}
									/>
								</Table.Cell>
								<Table.Cell class="font-medium text-ink">
									{[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
									{#if isChampionshipRow(row.flight)}
										<Badge variant="brass">Gross + Net</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-sm">{formatChanges(row.changes)}</Table.Cell>
								<Table.Cell class="text-sm text-flag">{row.errors.join(', ')}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}

		{#if addingRows.length > 0}
			<div class="flex flex-col gap-2">
				<p class="font-data text-xs tracking-widest text-fairway uppercase">Adding</p>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Include</Table.Head>
							<Table.Head>First name</Table.Head>
							<Table.Head>Last name</Table.Head>
							<Table.Head>Flight</Table.Head>
							<Table.Head>Handicap</Table.Head>
							<Table.Head>Notes</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each addingRows as row (row.rowNumber)}
							<Table.Row class={row.errors.length > 0 ? 'bg-flag/5' : ''}>
								<Table.Cell>
									<input
										type="checkbox"
										class="accent-brass"
										aria-label="Include {[row.first_name, row.last_name]
											.filter(Boolean)
											.join(' ') || `row ${row.rowNumber}`}"
										disabled={row.errors.length > 0}
										checked={included[row.rowNumber] ?? false}
										onchange={(e) => (included[row.rowNumber] = e.currentTarget.checked)}
									/>
								</Table.Cell>
								<Table.Cell class="font-medium text-ink">{row.first_name ?? '—'}</Table.Cell>
								<Table.Cell class="font-medium text-ink">{row.last_name ?? '—'}</Table.Cell>
								<Table.Cell>
									{row.flight || '—'}
									{#if isChampionshipRow(row.flight)}
										<Badge variant="brass">Gross + Net</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell class="font-data">{formatHandicapIndex(row.handicap_index)}</Table.Cell>
								<Table.Cell class="text-sm text-flag">{row.errors.join(', ')}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}

		<div class="flex items-center gap-2">
			<form
				method="POST"
				action="?/confirm"
				use:enhance={() => {
					confirmSubmitting = true;
					return async ({ update }) => {
						await update();
						confirmSubmitting = false;
					};
				}}
			>
				<input type="hidden" name="rows" value={confirmRows} />
				<Button type="submit" variant="brass" disabled={includedCount === 0 || confirmSubmitting}>
					{#if confirmSubmitting}
						<LoaderCircleIcon class="size-4 animate-spin" />
					{/if}
					{#if confirmSubmitting}
						Saving…
					{:else if addIncludedCount > 0 && updateIncludedCount > 0}
						Confirm ({addIncludedCount} adding, {updateIncludedCount} updating)
					{:else if updateIncludedCount > 0}
						Confirm ({updateIncludedCount} {updateIncludedCount === 1 ? 'update' : 'updates'})
					{:else if addEntryCount === addIncludedCount}
						Confirm import ({addIncludedCount})
					{:else}
						Confirm import ({addIncludedCount} rows → {addEntryCount} entries)
					{/if}
				</Button>
			</form>
			<Button type="button" variant="outline" disabled={confirmSubmitting} onclick={cancelPreview}
				>Cancel</Button
			>
		</div>
	{:else}
		<form
			method="POST"
			action="?/preview"
			enctype="multipart/form-data"
			use:enhance={() => {
				previewSubmitting = true;
				return async ({ update }) => {
					await update();
					previewSubmitting = false;
				};
			}}
		>
			<div
				class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-brass/40 bg-scorecard p-8 text-center"
			>
				<p class="font-data text-xs tracking-widest text-fairway uppercase">Player roster</p>
				<p class="text-sm text-ink/70">
					Choose a CSV file with First Name and Last Name columns for each competitor, plus flight
					and handicap. To update existing players instead of just adding new ones, start from
					<a
						href={resolve('/admin/tournaments/[slug]/players/export', {
							slug: data.tournament.slug
						})}
						class="text-brass hover:underline">the current roster export</a
					> — it includes the ID column this page matches edited rows against, leave it blank on any new
					rows you add.
				</p>
				<input
					type="file"
					name="file"
					accept=".csv,text/csv"
					required
					disabled={previewSubmitting}
					class="text-sm"
				/>
			</div>
			<Button type="submit" variant="brass" class="mt-4" disabled={previewSubmitting}>
				{#if previewSubmitting}
					<LoaderCircleIcon class="size-4 animate-spin" />
				{/if}
				{previewSubmitting ? 'Processing…' : 'Preview import'}
			</Button>
		</form>
	{/if}
</div>
