<script lang="ts">
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import type { Database } from '@emgc-calcutta/shared-types';
	import * as Dialog from '$lib/components/ui/dialog';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { deriveFlightDivisionGroups, type FlightDivisionGroup } from '$lib/flightGroups';
	import { formatPlayerName } from '$lib/players';

	interface PlayerOption {
		id: string;
		first_name: string;
		last_name: string;
		division: string;
	}

	type Selection = PlayerOption | null;
	type Group = FlightDivisionGroup;

	let {
		open = $bindable(false),
		supabase,
		tournamentId,
		flights,
		championshipFlight,
		payoutStructure,
		onSuccess
	}: {
		open?: boolean;
		supabase: SupabaseClient<Database>;
		tournamentId: string;
		flights: string[];
		championshipFlight: string | null;
		payoutStructure: Record<string, number>;
		onSuccess?: () => void;
	} = $props();

	let groups = $derived(deriveFlightDivisionGroups(flights, championshipFlight));

	// One row per configured payout place, shared by every group — the
	// same payout_structure percentages apply independently to each
	// group's own pot (confirmed decision), so there's only ever one
	// `spots` list, not one per group.
	let spots = $derived(
		Object.entries(payoutStructure)
			.map(([place, share]) => ({ placement: Number(place), share }))
			.sort((a, b) => a.placement - b.placement)
	);

	// Two different groups can legitimately share a placement number
	// (Flight A's 1st and Flight B's 1st are different rows), so every
	// per-spot state map below is keyed by (flight, division, placement)
	// together, not placement alone.
	function spotKey(group: { flight: string; division: string }, placement: number): string {
		return JSON.stringify([group.flight, group.division, placement]);
	}

	let selections: Record<string, Selection> = $state({});
	let queries: Record<string, string> = $state({});
	let suggestions: Record<string, PlayerOption[]> = $state({});
	let submitting = $state(false);
	let loadingExisting = $state(false);
	let errorMessage = $state('');

	const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

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
			.select('id, first_name, last_name, flight, division, placement')
			.eq('tournament_id', tournamentId)
			.not('placement', 'is', null);

		const next: Record<string, Selection> = {};
		for (const row of data ?? []) {
			if (row.placement !== null) {
				const key = spotKey({ flight: row.flight, division: row.division }, row.placement);
				next[key] = {
					id: row.id,
					first_name: row.first_name,
					last_name: row.last_name,
					division: row.division
				};
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
	// placement with the other on submit. Checked across every group, not
	// just the current one, though a player could only ever plausibly show
	// up in their own group's suggestions anyway (the search itself is
	// already scoped to the group's flight/division).
	function usedPlayerIds(excludeKey: string): Set<string> {
		return new Set(
			Object.entries(selections)
				.filter(([key]) => key !== excludeKey)
				.map(([, sel]) => sel?.id)
				.filter((id): id is string => !!id)
		);
	}

	function onQueryInput(group: Group, placement: number, value: string) {
		const key = spotKey(group, placement);
		queries[key] = value;
		clearTimeout(debounceTimers[key]);
		if (!value.trim()) {
			suggestions[key] = [];
			return;
		}
		debounceTimers[key] = setTimeout(() => runSearch(group, placement, value), 300);
	}

	// Only sold players are eligible for a placement — set-placement itself
	// rejects anything else, so the type-ahead never offers a choice
	// guaranteed to fail. Scoped to this group's own flight/division so a
	// search from one group's box can never suggest another group's player.
	async function runSearch(group: Group, placement: number, value: string) {
		const key = spotKey(group, placement);
		const { data } = await supabase
			.from('players')
			.select('id, first_name, last_name, division')
			.eq('tournament_id', tournamentId)
			.eq('flight', group.flight)
			.eq('division', group.division)
			.in('status', ['sold_silent', 'sold_live'])
			.or(`first_name.ilike.%${value}%,last_name.ilike.%${value}%`)
			.order('first_name')
			.order('last_name')
			.limit(8);

		const exclude = usedPlayerIds(key);
		suggestions[key] = ((data ?? []) as PlayerOption[]).filter((p) => !exclude.has(p.id));
	}

	function selectPlayer(group: Group, placement: number, player: PlayerOption) {
		const key = spotKey(group, placement);
		selections[key] = player;
		queries[key] = '';
		suggestions[key] = [];
	}

	function clearSpot(group: Group, placement: number) {
		selections[spotKey(group, placement)] = null;
	}

	// One bulk call carrying the full desired state across every group, not
	// one call per filled spot or per group — set-placement resolves
	// reassignments (vacating a spot before handing it to a different
	// player) server-side, which a sequence of independent per-spot calls
	// from here couldn't do correctly no matter what order they ran in.
	// Any configured place left empty in this form is implicitly "clear
	// whoever holds it," handled the same way on the server. flight/
	// division aren't sent — set-placement reads them off each targeted
	// player's own row, so this payload is exactly the same shape
	// regardless of how many groups are involved.
	async function submit() {
		submitting = true;
		errorMessage = '';

		const placements = groups.flatMap((group) =>
			spots
				.filter((s) => selections[spotKey(group, s.placement)])
				.map((s) => ({
					playerId: selections[spotKey(group, s.placement)]!.id,
					placement: s.placement
				}))
		);

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

			<div class="flex flex-col gap-6">
				{#each groups as group (`${group.flight}::${group.division}`)}
					<div class="flex flex-col gap-3">
						<h3 class="font-data text-xs tracking-widest text-fairway uppercase">
							{group.label}
						</h3>
						{#each spots as spot (spot.placement)}
							{@const key = spotKey(group, spot.placement)}
							<div class="flex flex-col gap-1">
								<span class="font-data text-xs tracking-wide text-muted-foreground uppercase">
									{ordinal(spot.placement)} &middot; {(spot.share * 100).toFixed(0)}%
								</span>

								{#if selections[key]}
									<div
										class="flex items-center justify-between rounded-md border border-input px-3 py-1.5 text-sm"
									>
										<span class="flex items-center gap-2 text-ink">
											{selections[key] ? formatPlayerName(selections[key]) : ''}
											<DivisionBadge division={selections[key]?.division ?? 'overall'} />
										</span>
										<button
											type="button"
											class="text-xs text-brass hover:underline"
											onclick={() => clearSpot(group, spot.placement)}
										>
											Change
										</button>
									</div>
								{:else}
									<div class="relative">
										<Input
											type="text"
											placeholder="Search players..."
											value={queries[key] ?? ''}
											oninput={(e) => onQueryInput(group, spot.placement, e.currentTarget.value)}
										/>
										{#if (suggestions[key]?.length ?? 0) > 0}
											<div
												class="absolute z-10 mt-1 w-full rounded-md border border-input bg-scorecard shadow-md"
											>
												{#each suggestions[key] as player (player.id)}
													<button
														type="button"
														class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brass/10"
														onclick={() => selectPlayer(group, spot.placement, player)}
													>
														{formatPlayerName(player)}
														<DivisionBadge division={player.division} />
													</button>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
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
