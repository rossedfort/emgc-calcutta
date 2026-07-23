<script lang="ts">
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data } = $props();
	let { profile } = $derived(data);
	let isAdmin = $derived(profile?.role === 'admin' || profile?.role === 'owner');
</script>

{#snippet topic(title: string, body: string)}
	<div class="flex flex-col gap-1">
		<p class="font-medium text-ink">{title}</p>
		<p class="text-sm text-ink/70">{body}</p>
	</div>
{/snippet}

{#snippet sectionLabel(text: string)}
	<p class="font-data text-[0.65rem] tracking-widest text-brass uppercase">{text}</p>
{/snippet}

<div class="mx-auto flex max-w-2xl flex-col gap-8">
	<PageHeader title="Help & instructions" eyebrow="Guide" />

	<p class="text-sm text-ink/70">
		A quick walkthrough of what you can do in the app, grouped by what you're here to do.
		{#if isAdmin}
			Since you're an {profile?.role}, you'll also find the admin tools below.
		{/if}
	</p>

	<section class="flex flex-col gap-5">
		{@render sectionLabel('Bidding & your account')}

		{@render topic(
			'Browsing the field',
			'Each tournament has a Players page listing every competitor, grouped by flight. A status badge shows whether a player is still open for silent bidding, reserved for the live auction, or already sold — and if a player is linked to your own account, you\'ll see a "This is you" badge on their card.'
		)}

		{@render topic(
			'Silent auction bidding',
			"While the silent auction window is open, place a bid on any player in a tournament you're entered in — each bid has to beat the current high bid by at least the tournament's minimum increment. Every connected bidder sees updated high bids the moment they land, so you're never bidding against a stale price. Once a player's high bid reaches the tournament's reservation threshold, they're automatically flagged \"Reserved\" and silent bidding on them freezes — they move into the live auction queue instead."
		)}

		{@render topic(
			'Live auction bidding',
			'An Admin opens one reserved player ("lot") at a time, in queue order. Bidding works the same way as the silent auction, plus an anti-snipe countdown: if a new bid lands close to the timer running out, the clock resets, so a lot never sells to a last-second bid nobody had a chance to answer. The Admin closes each lot — sold to the current high bidder, or "no bid" if nobody bid — before advancing to the next.'
		)}

		{@render topic(
			'Bids are anonymous',
			"You'll always see the current high bid amount, but never who placed it — bidder identity stays private throughout the auction, including your own. Bidding on a player linked to your own account is completely normal Calcutta behavior and isn't restricted in any way."
		)}

		{@render topic(
			'Notification preferences',
			'Turn email notifications on or off, and choose which triggers you want to hear about — outbid, someone bid on you, a player you bid on got reserved, the live auction is starting, or you won a player — from the Settings page.'
		)}

		<a href={resolve('/settings/notifications')} class="text-sm font-medium text-fairway underline">
			Go to notification settings →
		</a>

		{@render topic(
			'Your balance',
			"See what you owe (players you won) and what you're owed (payouts for players you entered who placed), including which ones are already settled, on your Balance page."
		)}

		<a href={resolve('/me/balance')} class="text-sm font-medium text-fairway underline">
			Go to my balance →
		</a>
	</section>

	{#if isAdmin}
		<section class="flex flex-col gap-5 border-t border-brass/30 pt-6">
			{@render sectionLabel('Admin & Owner tools')}

			{@render topic(
				'Importing players',
				'From a tournament\'s Players page, use "Import CSV" to preview and confirm a roster upload in one pass — flight, handicap, contact info, and (for CSV rows that email-match an existing account) the player-to-user link all come in together.'
			)}

			{@render topic(
				'Tournament settings',
				"Each tournament's settings page controls the silent auction window, reservation threshold, minimum bid increment, anti-snipe timing, flights, and payout structure (the percentage of the pot each finishing place earns)."
			)}

			{@render topic(
				'Running the live auction',
				"Build and reorder the live auction queue — manual up/down, or one-click sorts by handicap or shuffle — from the tournament's Queue page, then open, advance, and close lots one at a time from the Live Auction page."
			)}

			{@render topic(
				'Bids, voids & the audit log',
				"Void a bid with a required reason from a tournament's Bookkeeping page if it needs correcting (a duplicate click, a fat-fingered amount) — the void is logged, not silently deleted, and every state-changing action across the app (bids, voids, sales, role changes, and more) shows up in the searchable Audit log, filterable by player, actor, action, and date range."
			)}

			<a href={resolve('/admin/audit')} class="text-sm font-medium text-fairway underline">
				Go to the audit log →
			</a>

			{@render topic(
				'Marking bids and payouts paid, and setting placements',
				"Once the tournament wraps, enter each player's finishing place per flight/division from the tournament's Results page — this automatically calculates that flight's pot and each payout. From the Bookkeeping page, mark a winning bid as paid once the buyer settles up outside the app, and mark a payout as paid once you've sent a placement winner their share. Neither of these moves real money — they're just a record that it happened."
			)}

			<a href={resolve('/admin/tournaments')} class="text-sm font-medium text-fairway underline">
				Go to tournaments →
			</a>

			<div class="rounded-md border border-brass/30 bg-scorecard/40 p-4">
				<p class="font-medium text-ink">Owner-only</p>
				<p class="mt-1 text-sm text-ink/70">
					Only the Owner can promote a Participant to Admin or remove an Admin's access, from the
					Users page. Deleting a tournament's data outright and transferring ownership to someone
					else are both Owner-level privileges too, but neither has a self-service button in the app
					yet — for now, either of those goes through a direct request rather than an in-app action.
				</p>
			</div>

			<a href={resolve('/admin/users')} class="text-sm font-medium text-fairway underline">
				Go to users →
			</a>
		</section>
	{/if}
</div>
