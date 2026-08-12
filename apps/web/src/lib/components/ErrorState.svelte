<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { routes } from '$lib/routes';

	// Shared by the root error boundary (+error.svelte — a SvelteKit
	// load/routing error, always has a real HTTP status) and the app-wide
	// <svelte:boundary> fallback in the root +layout.svelte (an unhandled
	// client-side rendering error after hydration — no HTTP status at all,
	// since it never went through the server). `status` is optional for
	// exactly that second case; every visual element that would otherwise
	// show the status falls back to a plain "!" instead of a fabricated
	// number.
	let {
		status,
		description
	}: {
		status?: number;
		description: string;
	} = $props();

	// One universal shout ("Fore!") regardless of what went wrong, same as
	// on an actual course — the specific mishap underneath is what varies.
	// "Lie" is a real term for where a ball has come to rest, doing double
	// duty here as the sub-explanation label.
	const COPY: Record<number, { subhead: string; lie: string }> = {
		404: { subhead: 'Out of bounds.', lie: 'Lost ball — out of bounds' },
		500: { subhead: 'Shanked one.', lie: 'In the rough — our fault' }
	};
	const DEFAULT_COPY = { subhead: 'Off the fairway.', lie: 'Off the fairway' };
	let copy = $derived((status !== undefined ? COPY[status] : undefined) ?? DEFAULT_COPY);
	let badge = $derived(status !== undefined ? String(status) : '!');
</script>

<div class="flex flex-1 items-center justify-center p-4 sm:p-8">
	<div
		class="w-full max-w-lg rounded-lg border border-brass/30 bg-scorecard p-8 text-ink shadow-sm sm:p-10"
	>
		<div class="flex items-baseline justify-between gap-4">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">EMGC &middot; Bet</p>
			<span class="font-data shrink-0 rounded border border-flag/50 px-2 py-0.5 text-xs text-flag">
				{badge}
			</span>
		</div>

		<div class="mt-4">
			<p class="font-display text-5xl leading-none font-bold text-flag sm:text-6xl">Fore!</p>
			<p class="mt-2 font-display text-2xl font-semibold text-ink sm:text-3xl">{copy.subhead}</p>
		</div>

		<div class="mt-6 border-t border-brass/40"></div>

		<div class="mt-6 flex items-center gap-5">
			<div class="flex size-24 shrink-0 items-center justify-center rounded-full bg-sand/40">
				<svg viewBox="0 0 100 100" class="size-16" aria-hidden="true">
					<path
						d="M8,92 Q18,80 30,78"
						fill="none"
						stroke="var(--color-brass)"
						stroke-width="2"
						stroke-linecap="round"
						stroke-dasharray="3 4"
						opacity="0.5"
					/>
					<circle
						cx="30"
						cy="78"
						r="6"
						fill="var(--color-scorecard)"
						stroke="var(--color-brass)"
						stroke-width="2"
					/>
					<ellipse cx="60" cy="88" rx="32" ry="8" fill="var(--color-fairway)" opacity="0.15" />
					<ellipse cx="60" cy="87" rx="6" ry="2.5" fill="var(--color-ink)" opacity="0.4" />
					<line
						x1="60"
						y1="85"
						x2="60"
						y2="15"
						stroke="var(--color-brass)"
						stroke-width="3"
						stroke-linecap="round"
					/>
					<g class="pennant">
						<path d="M60,15 L95,15 L88,26 L95,37 L60,37 Z" fill="var(--color-flag)" />
						<text
							x="73"
							y="30"
							text-anchor="middle"
							font-family="var(--font-data)"
							font-size="10"
							font-weight="700"
							fill="var(--color-scorecard)"
						>
							{badge}
						</text>
					</g>
				</svg>
			</div>
			<div class="flex flex-col gap-1">
				<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Lie</span>
				<span class="font-data text-sm text-ink">{copy.lie}</span>
			</div>
		</div>

		<p class="mt-6 text-sm text-ink/70">{description}</p>

		<div class="mt-6 flex flex-wrap gap-2">
			<Button href={routes.home()} variant="brass">Back to the clubhouse</Button>
			<Button variant="outline" onclick={() => location.reload()}>Play it again</Button>
		</div>
	</div>
</div>

<style>
	.pennant {
		transform-origin: 60px 15px;
		animation: wave 2.6s ease-in-out infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.pennant {
			animation: none;
		}
	}

	@keyframes wave {
		0%,
		100% {
			transform: rotate(-3deg);
		}
		50% {
			transform: rotate(3deg);
		}
	}
</style>
