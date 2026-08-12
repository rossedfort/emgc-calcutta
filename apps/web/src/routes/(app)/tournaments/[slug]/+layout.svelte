<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { routes } from '$lib/routes';
	import { formatCountdown } from '$lib/time';
	import { tournamentPhase } from '$lib/tournamentPhase';
	import { onMount, setContext } from 'svelte';

	let { data, children } = $props();

	// Ticks every second so the phase banner/countdown below — and, via
	// context, whichever child board is active under {@render children()}
	// (the silent board's bid forms, the live board's anti-snipe countdown,
	// the roster's "time since last bid") — all stay live; none of those
	// are otherwise a tracked reactive dependency. Owned here (not also in
	// +page.svelte) since a layout can't pass extra props into its
	// children — context is the plain reactive-state baton that avoids two
	// independent one-second timers computing the same thing.
	let clock = $state({ now: new Date() });
	setContext('tournament-clock', clock);

	onMount(() => {
		const tick = setInterval(() => {
			clock.now = new Date();
		}, 1000);
		return () => {
			clearInterval(tick);
		};
	});

	let phase = $derived(tournamentPhase(data.tournament, clock.now));
	let countdownText = $derived(
		phase.countdownTo ? formatCountdown(phase.countdownTo, clock.now) : null
	);

	function tabClass(href: string, exact: boolean): string {
		const current = exact
			? page.url.pathname === href
			: page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
		return current
			? 'shrink-0 whitespace-nowrap border-b-2 border-brass px-1 pb-2 text-sm font-medium text-ink'
			: 'shrink-0 whitespace-nowrap border-b-2 border-transparent px-1 pb-2 text-sm text-muted-foreground hover:text-ink';
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-row flex-wrap gap-2 justify-between items-end">
		<PageHeader title={data.tournament.name} eyebrow="Tournament" />
		<div
			class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brass/30 bg-scorecard/40 px-4 py-2"
		>
			<div class="flex items-center gap-2 text-sm">
				<span
					class={[
						'inline-block size-2 rounded-full',
						phase.phase === 'silent' || phase.phase === 'live' ? 'bg-fairway' : 'bg-brass/60'
					]}
				></span>
				<span class="font-medium text-ink">{phase.label}</span>
				{#if countdownText}
					<span class="font-data rounded border border-brass/50 px-2 py-0.5 text-xs text-brass">
						{phase.countdownLabel}
						{countdownText}
					</span>
				{/if}
			</div>
		</div>
	</div>

	<nav class="flex gap-4 overflow-x-auto border-b border-brass/30">
		<a
			href={routes.tournament(data.tournament.slug)}
			class={tabClass(routes.tournament(data.tournament.slug), true)}>Auction</a
		>
		{#if data.tournament.status === 'complete'}
			<a
				href={routes.tournamentResults(data.tournament.slug)}
				class={tabClass(routes.tournamentResults(data.tournament.slug), false)}>Results</a
			>
		{/if}
		<a
			href={routes.myBids(data.tournament.slug)}
			class={tabClass(routes.myBids(data.tournament.slug), false)}>My Bids</a
		>
		<a
			href={routes.myBalance(data.tournament.slug)}
			class={tabClass(routes.myBalance(data.tournament.slug), false)}>My Balance</a
		>
	</nav>

	{@render children()}
</div>
