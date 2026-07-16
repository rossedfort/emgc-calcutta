<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type { Database } from '@emgc-calcutta/shared-types';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	interface PlayerOption {
		id: string;
		name: string;
	}

	type Selection = PlayerOption | null;

	let {
		open = $bindable(false),
		supabase,
		tournamentId,
		payoutStructure,
		onSuccess
	}: {
		open?: boolean;
		supabase: SupabaseClient<Database>;
		tournamentId: string;
		payoutStructure: Record<string, number>;
		onSuccess?: () => void;
	} = $props();

	// One row per configured payout place — spots come entirely from
	// payout_structure, not from any existing placement data, so an
	// unconfigured place never gets a row and a configured-but-unfilled
	// place always does.
	let spots = $derived(
		Object.entries(payoutStructure)
			.map(([place, share]) => ({ placement: Number(place), share }))
			.sort((a, b) => a.placement - b.placement)
	);

	let selections: Record<number, Selection> = $state({});
	let queries: Record<number, string> = $state({});
	let suggestions: Record<number, PlayerOption[]> = $state({});
	let submitting = $state(false);
	let loadingExisting = $state(false);
	let errorMessage = $state('');

	const debounceTimers: Record<number, ReturnType<typeof setTimeout>> = {};

	function ordinal(n: number): string {
		const suffixes = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
	}

	// Prefills each spot from whatever's already persisted (players.placement)
	// so reopening the modal to correct a result starts from the current
	// state, not a blank form — this is what makes "Edit results" the same
	// modal as "Enter results" rather than a second component.
	async function loadExisting() {
		loadingExisting = true;
		const { data } = await supabase
			.from('players')
			.select('id, name, placement')
			.eq('tournament_id', tournamentId)
			.not('placement', 'is', null);

		const next: Record<number, Selection> = {};
		for (const row of data ?? []) {
			if (row.placement !== null) {
				next[row.placement as number] = { id: row.id, name: row.name };
			}
		}
		selections = next;
		loadingExisting = false;
	}

	$effect(() => {
		if (open) {
			errorMessage = '';
			queries = {};
			suggestions = {};
			loadExisting();
		}
	});

	// A player already chosen for a different spot is excluded from every
	// other spot's suggestions — nothing stops the same player being typed
	// into two boxes otherwise, which would just silently overwrite one
	// placement with the other on submit.
	function usedPlayerIds(excludePlacement: number): Set<string> {
		return new Set(
			Object.entries(selections)
				.filter(([placement]) => Number(placement) !== excludePlacement)
				.map(([, sel]) => sel?.id)
				.filter((id): id is string => !!id)
		);
	}

	function onQueryInput(placement: number, value: string) {
		queries[placement] = value;
		clearTimeout(debounceTimers[placement]);
		if (!value.trim()) {
			suggestions[placement] = [];
			return;
		}
		debounceTimers[placement] = setTimeout(() => runSearch(placement, value), 300);
	}

	// Only sold players are eligible for a placement — set-placement itself
	// rejects anything else, so the type-ahead never offers a choice
	// guaranteed to fail.
	async function runSearch(placement: number, value: string) {
		const { data } = await supabase
			.from('players')
			.select('id, name')
			.eq('tournament_id', tournamentId)
			.in('status', ['sold_silent', 'sold_live'])
			.ilike('name', `%${value}%`)
			.order('name')
			.limit(8);

		const exclude = usedPlayerIds(placement);
		suggestions[placement] = ((data ?? []) as PlayerOption[]).filter((p) => !exclude.has(p.id));
	}

	function selectPlayer(placement: number, player: PlayerOption) {
		selections[placement] = player;
		queries[placement] = '';
		suggestions[placement] = [];
	}

	function clearSpot(placement: number) {
		selections[placement] = null;
	}

	// One bulk call carrying the full desired state, not one call per
	// filled spot — set-placement resolves reassignments (vacating a spot
	// before handing it to a different player) server-side, which a
	// sequence of independent per-spot calls from here couldn't do
	// correctly no matter what order they ran in. Any configured place
	// left empty in this form is implicitly "clear whoever holds it,"
	// handled the same way on the server.
	async function submit() {
		submitting = true;
		errorMessage = '';

		const placements = spots
			.filter((s) => selections[s.placement])
			.map((s) => ({ playerId: selections[s.placement]!.id, placement: s.placement }));

		const { error } = await supabase.functions.invoke('set-placement', {
			body: { tournamentId, placements }
		});

		submitting = false;

		if (error) {
			errorMessage = 'Failed to save results';
			if (error instanceof FunctionsHttpError) {
				const body = await error.context.json().catch(() => null);
				if (body?.error) errorMessage = body.error;
			}
			return;
		}

		onSuccess?.();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Enter results</Dialog.Title>
			<Dialog.Description>
				Search for a player by name and select them for each finishing place.
			</Dialog.Description>
		</Dialog.Header>

		{#if spots.length === 0}
			<p class="text-sm text-destructive">
				No payout structure configured for this tournament yet — set it on the Settings tab first.
			</p>
		{:else}
			{#if errorMessage}
				<p class="text-sm text-destructive">{errorMessage}</p>
			{/if}

			<div class="flex flex-col gap-3">
				{#each spots as spot (spot.placement)}
					<div class="flex flex-col gap-1">
						<span class="font-data text-xs tracking-wide text-muted-foreground uppercase">
							{ordinal(spot.placement)} &middot; {(spot.share * 100).toFixed(0)}%
						</span>

						{#if selections[spot.placement]}
							<div
								class="flex items-center justify-between rounded-md border border-input px-3 py-1.5 text-sm"
							>
								<span class="text-ink">{selections[spot.placement]?.name}</span>
								<button
									type="button"
									class="text-xs text-brass hover:underline"
									onclick={() => clearSpot(spot.placement)}
								>
									Change
								</button>
							</div>
						{:else}
							<div class="relative">
								<Input
									type="text"
									placeholder="Search players..."
									value={queries[spot.placement] ?? ''}
									oninput={(e) => onQueryInput(spot.placement, e.currentTarget.value)}
								/>
								{#if (suggestions[spot.placement]?.length ?? 0) > 0}
									<div
										class="absolute z-10 mt-1 w-full rounded-md border border-input bg-scorecard shadow-md"
									>
										{#each suggestions[spot.placement] as player (player.id)}
											<button
												type="button"
												class="block w-full px-3 py-1.5 text-left text-sm hover:bg-brass/10"
												onclick={() => selectPlayer(spot.placement, player)}
											>
												{player.name}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="brass" onclick={() => (open = false)} disabled={submitting}>Cancel</Button>
			<Button
				variant="brass"
				onclick={submit}
				disabled={submitting || loadingExisting || spots.length === 0}
			>
				{submitting ? 'Saving...' : 'Save results'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
