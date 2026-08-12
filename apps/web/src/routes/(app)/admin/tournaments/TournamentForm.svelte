<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import type { PayoutRow, TournamentFormValues } from './shared';

	interface Props {
		values: TournamentFormValues;
		payoutRows: PayoutRow[];
		flights: string[];
		errors: Record<string, string>;
		submitLabel: string;
	}

	let {
		values,
		payoutRows: initialPayoutRows,
		flights: initialFlights,
		errors,
		submitLabel
	}: Props = $props();

	// The datetime-local inputs below submit a raw "YYYY-MM-DDTHH:mm" string
	// with no timezone of its own — the server (parseTournamentForm) has no
	// way to know what offset that's relative to on its own, so this
	// browser's own offset rides along as a hidden field. Computed once at
	// component init, not reactively: the browser's own timezone doesn't
	// change mid-session, and by the time a user could actually submit the
	// form, hydration has already replaced any (irrelevant) SSR-computed
	// value with this real client-side one. Shared by every datetime-local
	// input in this form, including event_start_at (Phase 14) — one offset
	// for the whole form, not one per field.
	const tzOffsetMinutes = new Date().getTimezoneOffset();

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

	// Flights (Phase 7.5) — order matters (it's the display/ranking order
	// used everywhere else), so add/remove/reorder rather than a plain set.
	let flightRows = $state<string[]>(
		untrack(() => (initialFlights.length > 0 ? [...initialFlights] : ['']))
	);

	function addFlight() {
		flightRows = [...flightRows, ''];
	}

	function removeFlight(index: number) {
		flightRows = flightRows.filter((_, i) => i !== index);
	}

	function moveFlight(index: number, direction: -1 | 1) {
		const target = index + direction;
		if (target < 0 || target >= flightRows.length) return;
		const next = [...flightRows];
		[next[index], next[target]] = [next[target], next[index]];
		flightRows = next;
	}

	let flightNames = $derived(flightRows.map((f) => f.trim()).filter(Boolean));
	let flightsJson = $derived(JSON.stringify(flightNames));

	let championshipFlight = $state(untrack(() => values.championship_flight));

	let bidAnonymityEnabled = $state(untrack(() => values.bid_anonymity_enabled));

	// The Championship flight (if any) must always be one of the currently
	// entered flight names — if it's renamed or removed out from under it,
	// fall back to "none" rather than silently submitting a stale value.
	$effect(() => {
		if (championshipFlight && !flightNames.includes(championshipFlight)) {
			championshipFlight = '';
		}
	});
</script>

{#snippet sectionHeading(text: string)}
	<h3 class="font-data text-xs tracking-widest text-fairway uppercase">{text}</h3>
{/snippet}

<div class="flex flex-col gap-8">
	{#if errors.form}
		<p class="text-sm text-destructive">{errors.form}</p>
	{/if}

	<div class="flex flex-col gap-4">
		{@render sectionHeading('Basics')}

		<div class="flex flex-col gap-1.5">
			<Label for="name">Name</Label>
			<Input id="name" name="name" value={values.name} />
			{#if errors.name}<p class="text-sm text-destructive">{errors.name}</p>{/if}
		</div>

		<div class="flex flex-col gap-1.5">
			<Label>Type</Label>
			<div class="flex gap-4 text-sm">
				<label class="flex items-center gap-2">
					<input
						type="radio"
						name="kind"
						value="production"
						checked={values.kind !== 'dry_run'}
						class="accent-brass"
					/>
					Production
				</label>
				<label class="flex items-center gap-2">
					<input
						type="radio"
						name="kind"
						value="dry_run"
						checked={values.kind === 'dry_run'}
						class="accent-brass"
					/>
					Dry run
				</label>
			</div>
		</div>
	</div>

	<div class="flex flex-col gap-4 border-t border-brass/20 pt-6">
		{@render sectionHeading('Auction settings')}

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
			<p class="col-span-2 text-xs text-muted-foreground">
				Times are entered in your browser's local timezone.
			</p>
		</div>

		<input type="hidden" name="tz_offset_minutes" value={tzOffsetMinutes} />

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
				{#if errors.min_increment}<p class="text-sm text-destructive">
						{errors.min_increment}
					</p>{/if}
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="minimum_bid">Minimum opening bid ($)</Label>
				<Input
					id="minimum_bid"
					name="minimum_bid"
					type="number"
					step="0.01"
					min="0"
					value={values.minimum_bid}
				/>
				<p class="text-xs text-muted-foreground">
					Floor for a player's very first bid only — the increment above governs every bid after
					that.
				</p>
				{#if errors.minimum_bid}<p class="text-sm text-destructive">
						{errors.minimum_bid}
					</p>{/if}
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

		<div class="flex items-center justify-between gap-4">
			<div class="flex flex-col gap-0.5">
				<Label for="bid_anonymity_enabled">Hide bidder names</Label>
				<p class="text-sm text-muted-foreground">
					Suppress who's currently holding the high bid on the silent auction board and who won each
					player on the results page — the amount still shows either way.
				</p>
			</div>
			<Switch
				id="bid_anonymity_enabled"
				name="bid_anonymity_enabled"
				bind:checked={bidAnonymityEnabled}
			/>
		</div>
	</div>

	<div class="flex flex-col gap-4 border-t border-brass/20 pt-6">
		{@render sectionHeading('Buy-back')}
		<p class="-mt-2 text-xs text-muted-foreground">
			Lets a golfer buy back a share of their own stake from the winning bidder. Leave the
			percentage blank to keep this off for the tournament.
		</p>

		<div class="grid grid-cols-2 gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="buy_back_percentage">Buy-back percentage (optional)</Label>
				<Input
					id="buy_back_percentage"
					name="buy_back_percentage"
					type="number"
					min="1"
					max="99"
					step="1"
					placeholder="e.g. 50"
					class="max-w-40"
					value={values.buy_back_percentage}
				/>
				{#if errors.buy_back_percentage}<p class="text-sm text-destructive">
						{errors.buy_back_percentage}
					</p>{/if}
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="event_start_at">Tournament start (optional)</Label>
				<Input
					id="event_start_at"
					name="event_start_at"
					type="datetime-local"
					value={values.event_start_at}
				/>
				{#if errors.event_start_at}<p class="text-sm text-destructive">
						{errors.event_start_at}
					</p>{/if}
			</div>
			<p class="col-span-2 text-xs text-muted-foreground">
				When the actual golf starts — not the auction window above. Buy-back requests stop once this
				passes. Leave blank for no cutoff.
			</p>
		</div>
	</div>

	<div class="flex flex-col gap-4 border-t border-brass/20 pt-6">
		{@render sectionHeading('Flights')}

		<div class="flex flex-col gap-2">
			<Label>Flights (optional — order determines display/ranking order everywhere else)</Label>
			{#each flightRows.keys() as i (i)}
				<div class="flex items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={i === 0}
						onclick={() => moveFlight(i, -1)}>↑</Button
					>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={i === flightRows.length - 1}
						onclick={() => moveFlight(i, 1)}>↓</Button
					>
					<Input placeholder="Flight name" bind:value={flightRows[i]} class="max-w-64" />
					<Button type="button" variant="ghost" size="sm" onclick={() => removeFlight(i)}
						>Remove</Button
					>
				</div>
			{/each}
			<Button type="button" variant="outline" size="sm" class="w-fit" onclick={addFlight}
				>Add flight</Button
			>
			{#if errors.flights}<p class="text-sm text-destructive">{errors.flights}</p>{/if}
		</div>

		<div class="flex flex-col gap-1.5">
			<Label for="championship_flight">Championship flight (optional)</Label>
			<select
				id="championship_flight"
				name="championship_flight"
				bind:value={championshipFlight}
				disabled={flightNames.length === 0}
				class="h-9 max-w-64 rounded-md border border-input bg-transparent px-3 text-sm"
			>
				<option value="">— None —</option>
				{#each flightNames as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
			<p class="text-xs text-muted-foreground">
				Players in this flight are auctioned twice — once for Gross, once for Net.
			</p>
			{#if errors.championship_flight}<p class="text-sm text-destructive">
					{errors.championship_flight}
				</p>{/if}
		</div>

		<input type="hidden" name="flights" value={flightsJson} />
	</div>

	<div class="flex flex-col gap-4 border-t border-brass/20 pt-6">
		{@render sectionHeading('Payout structure')}

		<div class="flex flex-col gap-2">
			<Label>Payout structure (optional — can be finalized later, before results are entered)</Label
			>
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
					<Button type="button" variant="ghost" size="sm" onclick={() => removeRow(i)}
						>Remove</Button
					>
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
	</div>

	<Button type="submit" variant="brass" class="w-fit">{submitLabel}</Button>
</div>
