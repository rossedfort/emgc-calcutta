<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { tournamentPhase } from '$lib/tournamentPhase';
	import OnboardingModal from './OnboardingModal.svelte';

	let { data } = $props();
	let { tournaments } = $derived(data);
	let isAdmin = $derived(data.profile?.role === 'admin' || data.profile?.role === 'owner');
	let isUnassigned = $derived(data.profile?.role === 'unassigned' && !data.profile?.rejected_at);
	let isRejected = $derived(data.profile?.role === 'unassigned' && !!data.profile?.rejected_at);

	function formatWindow(startIso: string, endIso: string): string {
		const start = new Date(startIso);
		const end = new Date(endIso);
		const day = (d: Date) =>
			new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
		if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
			return `${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(start)} ${start.getDate()}–${end.getDate()}`;
		}
		return `${day(start)}–${day(end)}`;
	}

	function formatCurrency(amount: number): string {
		return `$${amount.toLocaleString('en-US')}`;
	}
</script>

{#if data.profile}
	<OnboardingModal
		profile={data.profile}
		notificationsSetupPending={data.notificationsSetupPending}
	/>
{/if}

<div class="flex flex-col gap-6">
	{#each tournaments as tournament (tournament.id)}
		{@const phase = tournamentPhase(tournament, new Date())}
		{@const isActive = phase.phase === 'silent' || phase.phase === 'live'}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-8 text-ink shadow-sm">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">EMGC &middot; Bet</p>

			<div class="mt-2 flex items-baseline justify-between gap-4">
				<h1 class="font-display text-4xl font-semibold text-ink">{tournament.name}</h1>
				<span
					class="font-data shrink-0 rounded border border-brass/50 px-2 py-0.5 text-sm text-brass"
				>
					{new Date(tournament.silent_auction_start).getFullYear()}
				</span>
			</div>

			<div class="mt-4 border-t border-brass/40"></div>

			<div class="mt-4 flex items-center gap-2 text-sm">
				<span class={['inline-block size-2 rounded-full', isActive ? 'bg-fairway' : 'bg-brass/60']}
				></span>
				<span>{phase.label}</span>
			</div>

			<div
				class="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-brass/40 bg-brass/40 sm:grid-cols-4"
			>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Window</span>
					<span class="font-data text-sm text-ink">
						{formatWindow(tournament.silent_auction_start, tournament.silent_auction_end)}
					</span>
				</div>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Thresh.</span>
					<span class="font-data text-sm text-ink"
						>{formatCurrency(tournament.threshold_amount)}</span
					>
				</div>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Min inc</span>
					<span class="font-data text-sm text-ink">{formatCurrency(tournament.min_increment)}</span>
				</div>
				<div class="flex flex-col gap-1 bg-scorecard p-3">
					<span class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Snipe</span>
					<span class="font-data text-sm text-ink">{tournament.anti_snipe_seconds}s</span>
				</div>
			</div>

			<div class="mt-6 flex items-center gap-2">
				<Button
					href={resolve('/tournaments/[slug]', { slug: tournament.slug })}
					variant={isActive ? 'fairway' : 'brass'}
				>
					{isActive ? 'Join Auction' : 'View the field'}
				</Button>
				{#if isAdmin}
					<Button
						href={resolve('/admin/tournaments/[slug]', { slug: tournament.slug })}
						variant="brass">Manage tournament</Button
					>
				{/if}
			</div>
		</div>
	{:else}
		<div class="rounded-lg border border-brass/30 bg-scorecard p-8 text-ink shadow-sm">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">EMGC &middot; Bet</p>
			<h1 class="mt-2 font-display text-3xl font-semibold text-ink">
				{#if isAdmin}
					No tournament set up yet
				{:else if isRejected}
					Account not approved
				{:else if isUnassigned}
					Almost there
				{:else}
					Nothing scheduled yet
				{/if}
			</h1>
			<p class="mt-2 text-sm text-ink/70">
				{#if isAdmin}
					Create this year's tournament to open it up for the league.
				{:else if isRejected}
					An Admin reviewed your sign-in and didn't approve it for this league. If that seems wrong,
					reach out to a league Admin directly.
				{:else if isUnassigned}
					An Admin needs to approve your account before you can view or bid. Check back once that
					happens.
				{:else}
					Check back once an Admin sets up this year’s tournament.
				{/if}
			</p>

			{#if isAdmin}
				<div class="mt-6">
					<Button href={resolve('/admin/tournaments/new')} variant="brass">Create tournament</Button
					>
				</div>
			{/if}
		</div>
	{/each}
</div>
