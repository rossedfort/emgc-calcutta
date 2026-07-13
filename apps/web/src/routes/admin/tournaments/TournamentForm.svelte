<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { PayoutRow, TournamentFormValues } from './shared';

	interface Props {
		values: TournamentFormValues;
		payoutRows: PayoutRow[];
		errors: Record<string, string>;
		submitLabel: string;
	}

	let { values, payoutRows: initialPayoutRows, errors, submitLabel }: Props = $props();

	// Seeds local, independently-editable row state from the prop once — not
	// a live mirror of it, since the user adds/removes/edits rows from here.
	let rows = $state<PayoutRow[]>(
		untrack(() =>
			initialPayoutRows.length > 0 ? [...initialPayoutRows] : [{ place: '1', percent: '' }]
		)
	);

	function addRow() {
		rows = [...rows, { place: String(rows.length + 1), percent: '' }];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}

	let payoutJson = $derived(
		JSON.stringify(
			Object.fromEntries(
				rows.filter((r) => r.place && r.percent).map((r) => [r.place, Number(r.percent) / 100])
			)
		)
	);
</script>

<div class="flex flex-col gap-4">
	{#if errors.form}
		<p class="text-sm text-destructive">{errors.form}</p>
	{/if}

	<div class="flex flex-col gap-1.5">
		<Label for="name">Name</Label>
		<Input id="name" name="name" value={values.name} />
		{#if errors.name}<p class="text-sm text-destructive">{errors.name}</p>{/if}
	</div>

	<div class="grid grid-cols-2 gap-4">
		<div class="flex flex-col gap-1.5">
			<Label for="silent_auction_start">Silent auction start</Label>
			<Input
				id="silent_auction_start"
				name="silent_auction_start"
				type="datetime-local"
				value={values.silent_auction_start}
			/>
			{#if errors.silent_auction_start}<p class="text-sm text-destructive">
					{errors.silent_auction_start}
				</p>{/if}
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="silent_auction_end">Silent auction end</Label>
			<Input
				id="silent_auction_end"
				name="silent_auction_end"
				type="datetime-local"
				value={values.silent_auction_end}
			/>
			{#if errors.silent_auction_end}<p class="text-sm text-destructive">
					{errors.silent_auction_end}
				</p>{/if}
		</div>
	</div>

	<div class="grid grid-cols-2 gap-4">
		<div class="flex flex-col gap-1.5">
			<Label for="threshold_amount">Reservation threshold ($)</Label>
			<Input
				id="threshold_amount"
				name="threshold_amount"
				type="number"
				step="0.01"
				min="0"
				value={values.threshold_amount}
			/>
			{#if errors.threshold_amount}<p class="text-sm text-destructive">
					{errors.threshold_amount}
				</p>{/if}
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="min_increment">Minimum bid increment ($)</Label>
			<Input
				id="min_increment"
				name="min_increment"
				type="number"
				step="0.01"
				min="0"
				value={values.min_increment}
			/>
			{#if errors.min_increment}<p class="text-sm text-destructive">{errors.min_increment}</p>{/if}
		</div>
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="anti_snipe_seconds">Anti-snipe window (seconds)</Label>
		<Input
			id="anti_snipe_seconds"
			name="anti_snipe_seconds"
			type="number"
			step="1"
			min="0"
			class="max-w-40"
			value={values.anti_snipe_seconds}
		/>
		{#if errors.anti_snipe_seconds}<p class="text-sm text-destructive">
				{errors.anti_snipe_seconds}
			</p>{/if}
	</div>

	<div class="flex flex-col gap-2">
		<Label>Payout structure (optional — can be finalized later, before results are entered)</Label>
		{#each rows as row, i (i)}
			<div class="flex items-center gap-2">
				<Input
					type="number"
					min="1"
					step="1"
					placeholder="Place"
					bind:value={row.place}
					class="w-24"
				/>
				<span class="text-sm text-muted-foreground">place gets</span>
				<Input
					type="number"
					min="0"
					max="100"
					step="1"
					placeholder="%"
					bind:value={row.percent}
					class="w-24"
				/>
				<span class="text-sm text-muted-foreground">%</span>
				<Button type="button" variant="ghost" size="sm" onclick={() => removeRow(i)}>Remove</Button>
			</div>
		{/each}
		<Button type="button" variant="outline" size="sm" class="w-fit" onclick={addRow}
			>Add place</Button
		>
		{#if errors.payout_structure}<p class="text-sm text-destructive">
				{errors.payout_structure}
			</p>{/if}
	</div>

	<input type="hidden" name="payout_structure" value={payoutJson} />

	<Button type="submit" variant="brass" class="w-fit">{submitLabel}</Button>
</div>
