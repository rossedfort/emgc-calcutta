<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import DivisionBadge from './DivisionBadge.svelte';
	import { Badge, type BadgeVariant } from './ui/badge';

	// Mobile counterpart to a player row in a ui/table (SilentAuctionBoard,
	// TournamentRoster) — below md, a 5-column table forces horizontal
	// scroll just to reach a bid input, so those two pages swap to a list
	// of these instead (table stays for md and up). Owns only the identity/
	// status header both pages share; the differing body (a live bid form
	// vs. a read-only current-bid/last-bid line) is the caller's own
	// snippet, not a lowest-common-denominator prop list.
	//
	// Takes slug/playerSlug rather than a pre-resolved href — resolve() is
	// always called at the point of rendering the <a> everywhere else in
	// this app (see AppShell), and both current call sites link to the same
	// route shape anyway.
	let {
		slug,
		playerSlug,
		name,
		division,
		isYou = false,
		handicap,
		position,
		statusLabel,
		statusVariant,
		reserved = false,
		children
	}: {
		slug: string;
		playerSlug: string;
		name: string;
		division: string;
		isYou?: boolean;
		handicap: string;
		// 1-indexed rank within the player's own (flight, division) group —
		// undefined for a caller that hasn't grouped/sorted its list that way.
		// The group is already sorted by handicap ascending wherever this is
		// used, so this is just that sorted array's own index + 1, not a
		// separate lookup.
		position?: number;
		// Undefined for a caller whose table never had a Status column either
		// (TournamentRoster) — a card view shouldn't surface information the
		// desktop table it mirrors doesn't already show.
		statusLabel?: string;
		statusVariant?: BadgeVariant;
		reserved?: boolean;
		children: Snippet;
	} = $props();
</script>

<div class={['rounded-lg border border-brass/30 bg-scorecard p-4', reserved && 'bg-flag/10']}>
	<div class="flex items-start justify-between gap-3">
		<div class="flex min-w-0 flex-col gap-1.5">
			<a
				href={resolve('/tournaments/[slug]/players/[playerSlug]', { slug, playerSlug })}
				class="font-display text-lg leading-tight font-semibold text-ink hover:underline"
			>
				{name}
			</a>
			<div class="flex flex-wrap items-center gap-1.5">
				<DivisionBadge {division} />
				{#if isYou}
					<Badge variant="brass">This is you</Badge>
				{/if}
				{#if position}
					<span class="font-data text-xs text-ink/60">#{position} in flight</span>
					<span class="text-ink/30">·</span>
				{/if}
				<span class="font-data text-xs text-ink/60">HCP {handicap}</span>
			</div>
		</div>
		{#if statusLabel && statusVariant}
			<Badge variant={statusVariant} class="shrink-0">{statusLabel}</Badge>
		{/if}
	</div>
	<div class="mt-3 border-t border-brass/20 pt-3">
		{@render children()}
	</div>
</div>
