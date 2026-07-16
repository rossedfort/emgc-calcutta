<script lang="ts">
	import type { ImportCsvPreviewResponse } from '@emgc-calcutta/shared-types';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data, form } = $props();

	let step = $state<'upload' | 'preview' | 'done'>('upload');
	let previewData = $state<ImportCsvPreviewResponse | null>(null);
	let importedCount = $state(0);

	// Per-row checkbox state, seeded whenever a new preview payload arrives —
	// error rows start unchecked (can't be imported until the CSV is fixed),
	// matched rows start with their auto-match kept.
	let included = $state<Record<number, boolean>>({});
	let keepLink = $state<Record<number, boolean>>({});

	$effect(() => {
		if (form && 'step' in form) {
			if (form.step === 'preview' && 'preview' in form) {
				// Read from `form.preview` (a local, not the `previewData` state
				// this effect also writes) — reading the state var back inside the
				// same effect that assigns it re-triggers the effect on its own
				// write, causing an infinite loop (effect_update_depth_exceeded).
				const nextPreview = form.preview as ImportCsvPreviewResponse;
				const nextIncluded: Record<number, boolean> = {};
				const nextKeepLink: Record<number, boolean> = {};
				for (const row of nextPreview.rows) {
					nextIncluded[row.rowNumber] = row.errors.length === 0;
					nextKeepLink[row.rowNumber] = true;
				}
				previewData = nextPreview;
				included = nextIncluded;
				keepLink = nextKeepLink;
				step = 'preview';
			} else if (form.step === 'done' && 'imported' in form) {
				importedCount = (form.imported as { count: number }).count;
				step = 'done';
			}
		}
	});

	let errorMessage = $derived(form && 'error' in form ? (form.error as string) : null);

	let includedCount = $derived(Object.values(included).filter(Boolean).length);

	// A Championship-flight row becomes two players rows on confirm — this
	// is the actual number of rows that will be created, not just the
	// number of CSV lines selected.
	let entryCount = $derived(
		(previewData?.rows ?? [])
			.filter((row) => included[row.rowNumber])
			.reduce((sum, row) => sum + (isChampionshipRow(row.flight) ? 2 : 1), 0)
	);

	let confirmRows = $derived(
		JSON.stringify(
			(previewData?.rows ?? [])
				.filter((row) => included[row.rowNumber])
				.map((row) => ({
					name: row.name,
					contact_email: row.contact_email,
					contact_phone: row.contact_phone,
					flight: row.flight,
					handicap_index: row.handicap_index,
					preferences: row.preferences,
					photo_url: row.photo_url,
					userId: keepLink[row.rowNumber] ? row.matchedUserId : null
				}))
		)
	);

	function cancelPreview() {
		step = 'upload';
		previewData = null;
	}

	// A row whose flight is the tournament's Championship flight becomes two
	// players rows on confirm (Gross + Net) — flagged here so the preview
	// isn't a silent surprise about the eventual player count.
	function isChampionshipRow(flight: string | null): boolean {
		return !!data.tournament.championship_flight && flight === data.tournament.championship_flight;
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

	{#if step === 'done'}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
			<p class="font-display text-xl font-semibold text-ink">
				{importedCount}
				{importedCount === 1 ? 'player' : 'players'} added to the roster
			</p>
			<div class="mt-4">
				<Button
					href={resolve('/admin/tournaments/[slug]/players', { slug: data.tournament.slug })}
					variant="brass">Back to players</Button
				>
			</div>
		</div>
	{:else if step === 'preview' && previewData}
		<div class="flex items-center gap-4 text-sm">
			<span class="font-data flex items-center gap-2">
				<span class="size-1.5 rounded-full bg-fairway"></span>
				{previewData.validCount} ready to import
			</span>
			{#if previewData.errorCount > 0}
				<span class="font-data flex items-center gap-2 text-flag">
					<span class="size-1.5 rounded-full bg-flag"></span>
					{previewData.errorCount}
					{previewData.errorCount === 1 ? 'row needs' : 'rows need'} attention
				</span>
			{/if}
		</div>

		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Include</Table.Head>
					<Table.Head>Name</Table.Head>
					<Table.Head>Contact</Table.Head>
					<Table.Head>Flight</Table.Head>
					<Table.Head>Handicap</Table.Head>
					<Table.Head>Match</Table.Head>
					<Table.Head>Notes</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each previewData.rows as row (row.rowNumber)}
					<Table.Row class={row.errors.length > 0 ? 'bg-flag/5' : ''}>
						<Table.Cell>
							<input
								type="checkbox"
								class="accent-brass"
								aria-label="Include {row.name ?? `row ${row.rowNumber}`}"
								disabled={row.errors.length > 0}
								checked={included[row.rowNumber] ?? false}
								onchange={(e) => (included[row.rowNumber] = e.currentTarget.checked)}
							/>
						</Table.Cell>
						<Table.Cell class="font-medium text-ink">{row.name ?? '—'}</Table.Cell>
						<Table.Cell class="text-sm">
							{row.contact_email ?? '—'}
							{#if row.contact_phone}
								<br /><span class="text-muted-foreground">{row.contact_phone}</span>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{row.flight || '—'}
							{#if isChampionshipRow(row.flight)}
								<Badge variant="brass">Gross + Net</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="font-data">{row.handicap_index ?? '—'}</Table.Cell>
						<Table.Cell>
							{#if row.matchedUserId}
								<label class="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										class="accent-brass"
										checked={keepLink[row.rowNumber] ?? true}
										onchange={(e) => (keepLink[row.rowNumber] = e.currentTarget.checked)}
									/>
									<Badge variant="fairway">Linked · {row.matchedUserEmail}</Badge>
								</label>
							{:else}
								<Badge variant="sand">No match</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-sm text-flag">
							{row.errors.join(', ')}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>

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
					{confirmSubmitting
						? 'Importing…'
						: entryCount === includedCount
							? `Confirm import (${includedCount})`
							: `Confirm import (${includedCount} rows → ${entryCount} players)`}
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
					Choose a CSV file with each competitor's name, contact info, and flight.
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
				{previewSubmitting ? 'Processing…' : 'Preview import'}
			</Button>
		</form>
	{/if}
</div>
