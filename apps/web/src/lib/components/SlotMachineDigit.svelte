<script lang="ts">
	import { untrack } from 'svelte';

	// One reel of a slot-machine/odometer effect — renders a single digit
	// '0'-'9' and, whenever it changes, spins forward through a couple of
	// full 0-9 cycles before landing on the new value. Always spins forward
	// (never backward) since every caller of this component so far only
	// ever displays monotonically-increasing numbers (a bid amount can only
	// go up) — there's no "shortest path" logic because there's never a
	// need for one yet.
	// `spinIn`: this reel's very first mount should spin up from 0 instead of
	// silently snapping to its target — used for a digit appearing for the
	// first time because a player went from "no bid yet" to having one while
	// the board was already open (the caller only sets this true once past
	// its own initial load; see SilentAuctionBoard's `pastInitialLoad`).
	// Left false (the default), a fresh mount snaps with no animation, which
	// is what every *other* reel creation needs — e.g. the normal case of
	// loading the page on a player who already has a bid, where spinning in
	// on every page load would be noise, not signal.
	let {
		digit,
		delayMs = 0,
		spinIn = false
	}: { digit: string; delayMs?: number; spinIn?: boolean } = $props();

	const SPIN_CYCLES = 2;
	const ROW_HEIGHT_EM = 1.2;
	const TRANSITION_MS = 700;

	// The position only ever increases — its own value modulo 10 is what's
	// actually displayed, so "spinning" is just letting a CSS transition
	// animate toward a bigger translateY rather than snapping to it.
	let position = $state(untrack(() => (spinIn ? 0 : Number(digit))));
	// The lowest reel index still rendered. Kept equal to `position`
	// whenever idle, so only one element (the current digit) exists in the
	// DOM — dropped back down to the spin's starting point whenever a new
	// spin begins, so the reel temporarily grows just enough to visibly
	// scroll through, then collapses back to one element once the spin has
	// had time to finish. The wrapper element itself is always mounted
	// (never conditionally created/destroyed) — an earlier version tried
	// conditionally rendering the whole reel only while "animating", but an
	// element born already at its destination transform has nothing to
	// visually transition *from*, so nothing ever appeared to spin.
	let floor = $state(untrack(() => (spinIn ? 0 : Number(digit))));
	let mounted = false;
	// Disables the transform transition for exactly one change — used to
	// collapse the reel back down with no visible jump (the digit shown
	// doesn't change, only how many now-offscreen elements still exist
	// above it).
	let skipTransition = $state(false);

	// The read-then-write on `position` below must not make this effect
	// depend on `position` itself — otherwise every write re-triggers the
	// same effect, which writes again, forever (an infinite loop that pegs
	// the CPU and freezes the tab). `digit` is the only thing that should
	// ever re-run this.
	$effect(() => {
		const target = Number(digit);
		untrack(() => {
			if (!mounted) {
				mounted = true;
				if (!spinIn) {
					position = target;
					floor = target;
					return;
				}
				// spinIn: fall through to the same spin logic below, starting
				// from the 0 that `position`/`floor` were initialized to above.
			}
			const current = position % 10;
			// This reel's own digit hasn't actually changed — don't spin. This
			// is what keeps a bid on one player from animating every *other*
			// player's unrelated digits too: this component only ever reacts
			// to its own `digit` prop, but a multi-digit amount re-rendering
			// (even when every character's value is unchanged) can still cause
			// this effect to run — spinning here would be wrong regardless of
			// why the effect ran, since nothing about *this* digit changed.
			if (current === target) return;
			const delta = (target - current + 10) % 10;
			position += delta + 10 * SPIN_CYCLES;

			// Collapse back to a single element once this spin has had time
			// to land — driven by our own timer rather than the DOM's
			// `transitionend` event, which turned out to fire unreliably
			// (sometimes not at all, sometimes for a stale, already-superseded
			// transition) whenever a second spin started before the first had
			// fully settled. The snapshot-and-compare guard below skips a
			// stale collapse if a *newer* spin has since taken over — that
			// spin's own timer will collapse it instead.
			const scheduledForPosition = position;
			setTimeout(
				() => {
					untrack(() => {
						if (position !== scheduledForPosition) return;
						skipTransition = true;
						floor = position;
						requestAnimationFrame(() => requestAnimationFrame(() => (skipTransition = false)));
					});
				},
				TRANSITION_MS + delayMs + 50
			);
		});
	});
</script>

<span
	class="relative inline-block overflow-hidden align-bottom"
	style="height: {ROW_HEIGHT_EM}em; width: 0.62em;"
>
	<span
		class="absolute inset-x-0 top-0 ease-out"
		style="transform: translateY(-{(position - floor) *
			ROW_HEIGHT_EM}em); transition-property: transform; transition-duration: {skipTransition
			? '0s'
			: TRANSITION_MS + 'ms'}; transition-delay: {skipTransition ? '0s' : delayMs + 'ms'};"
	>
		{#each [...Array(position - floor + 1).keys()] as i (i)}
			<span
				class="block text-center"
				style="height: {ROW_HEIGHT_EM}em; line-height: {ROW_HEIGHT_EM}em;"
			>
				{(floor + i) % 10}
			</span>
		{/each}
	</span>
</span>
