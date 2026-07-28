<script lang="ts">
	import { untrack } from 'svelte';

	// One reel of a slot-machine/odometer effect — renders a single digit
	// '0'-'9' and, whenever it changes, spins forward through a couple of
	// full 0-9 cycles before landing on the new value. Always spins forward
	// (never backward) since every caller of this component so far only
	// ever displays monotonically-increasing numbers (a bid amount can only
	// go up) — there's no "shortest path" logic because there's never a
	// need for one yet.
	let { digit, delayMs = 0 }: { digit: string; delayMs?: number } = $props();

	const SPIN_CYCLES = 2;
	const ROW_HEIGHT_EM = 1.2;

	// The position only ever increases — its own value modulo 10 is what's
	// actually displayed, so "spinning" is just letting a CSS transition
	// animate toward a bigger translateY rather than snapping to it.
	let position = $state(untrack(() => Number(digit)));
	let mounted = false;

	// The read-then-write on `position` below must not make this effect
	// depend on `position` itself — otherwise every write re-triggers the
	// same effect, which writes again, forever (an infinite loop that pegs
	// the CPU and freezes the tab). `digit` is the only thing that should
	// ever re-run this.
	$effect(() => {
		const target = Number(digit);
		untrack(() => {
			if (!mounted) {
				// Lands immediately on first render — nothing to spin *from* yet.
				position = target;
				mounted = true;
				return;
			}
			const current = position % 10;
			const delta = (target - current + 10) % 10;
			position += (delta === 0 ? 10 : delta) + 10 * SPIN_CYCLES;
		});
	});
</script>

<span
	class="relative inline-block overflow-hidden align-bottom"
	style="height: {ROW_HEIGHT_EM}em; width: 0.62em;"
>
	<span
		class="absolute inset-x-0 top-0 transition-transform ease-out"
		style="transform: translateY(-{position *
			ROW_HEIGHT_EM}em); transition-duration: 700ms; transition-delay: {delayMs}ms;"
	>
		{#each [...Array(position + 1).keys()] as i (i)}
			<span
				class="block text-center"
				style="height: {ROW_HEIGHT_EM}em; line-height: {ROW_HEIGHT_EM}em;"
			>
				{i % 10}
			</span>
		{/each}
	</span>
</span>
