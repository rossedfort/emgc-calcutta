<script lang="ts">
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import * as Accordion from '$lib/components/ui/accordion';

	let { data } = $props();
	let { profile } = $derived(data);
	let isAdmin = $derived(profile?.role === 'admin' || profile?.role === 'owner');
</script>

{#snippet sectionLabel(text: string)}
	<p class="font-data text-[0.65rem] tracking-widest text-brass uppercase">{text}</p>
{/snippet}

<div class="mx-auto flex max-w-2xl flex-col gap-8">
	<PageHeader title="Help & instructions" eyebrow="Guide" />

	<p class="text-sm text-ink/70">
		Answers to the most common questions, grouped by what you're here to do. Tap a question to
		expand it.
		{#if isAdmin}
			Since you're an {profile?.role}, you'll also find the admin tools below.
		{/if}
	</p>

	<section class="flex flex-col gap-2">
		{@render sectionLabel('Bidding & your account')}

		<Accordion.Root type="multiple" class="mt-1">
			<Accordion.Item value="browsing-field" class="border-brass/20">
				<Accordion.Trigger class="text-ink">How do I see who's in a tournament?</Accordion.Trigger>
				<Accordion.Content class="text-ink/70">
					Each tournament has a Players page listing every competitor, grouped by flight. A status
					badge shows whether a player is still open for silent bidding, reserved for the live
					auction, already sold, or pooled into the field (see below) — and if a player is linked to
					your own account, you'll see a "This is you" badge on their card.
				</Accordion.Content>
			</Accordion.Item>

			<Accordion.Item value="silent-bidding" class="border-brass/20">
				<Accordion.Trigger class="text-ink">How does silent auction bidding work?</Accordion.Trigger
				>
				<Accordion.Content class="text-ink/70">
					While the silent auction window is open, place a bid on any player in a tournament you're
					entered in — each bid has to beat the current high bid by at least the tournament's
					minimum increment. Every connected bidder sees updated high bids the moment they land, so
					you're never bidding against a stale price. Once a player's high bid reaches the
					tournament's reservation threshold, they're automatically flagged "Reserved" and silent
					bidding on them freezes — they move into the live auction queue instead.
				</Accordion.Content>
			</Accordion.Item>

			<Accordion.Item value="the-field" class="border-brass/20">
				<Accordion.Trigger class="text-ink"
					>What happens to a player nobody bids on?</Accordion.Trigger
				>
				<Accordion.Content class="text-ink/70">
					If a player draws zero bids by the time the silent auction closes, they're pooled together
					with every other zero-bid player in their same flight (and division, for the Championship
					flight) into one lot called "The Field," which goes straight into the live auction queue.
					Anyone can bid on The Field like any other lot — whoever buys it becomes the buyer of
					record for every player pooled inside it, and collects a payout for each one that ends up
					in a paid finishing place. A swept player's own profile page links to their field lot, and
					the field lot's own page lists everyone pooled inside it.
				</Accordion.Content>
			</Accordion.Item>

			<Accordion.Item value="live-bidding" class="border-brass/20">
				<Accordion.Trigger class="text-ink">How does live auction bidding work?</Accordion.Trigger>
				<Accordion.Content class="text-ink/70">
					An Admin opens one reserved player ("lot") at a time, in queue order. Bidding works the
					same way as the silent auction, plus an anti-snipe countdown: if a new bid lands close to
					the timer running out, the clock resets, so a lot never sells to a last-second bid nobody
					had a chance to answer. The lot closes automatically the instant that countdown reaches
					zero — sold to the current high bidder, or "no bid" if nobody bid — before the Admin
					advances to the next lot; the Admin can also close a lot early once it's clear no one else
					is going to bid.
				</Accordion.Content>
			</Accordion.Item>

			<Accordion.Item value="minimum-opening-bid" class="border-brass/20">
				<Accordion.Trigger class="text-ink"
					>Is there a minimum bid to open on a player?</Accordion.Trigger
				>
				<Accordion.Content class="text-ink/70">
					Yes — every player (and The Field, once it's live) has a minimum opening bid set by the
					tournament's Admin. That floor only applies to the very first bid on a player; every bid
					after that just needs to beat the current high by the tournament's minimum increment,
					exactly as usual.
				</Accordion.Content>
			</Accordion.Item>

			<Accordion.Item value="bidder-identity" class="border-brass/20">
				<Accordion.Trigger class="text-ink">Can other bidders see who I am?</Accordion.Trigger>
				<Accordion.Content class="text-ink/70">
					The silent auction board shows who's currently holding the high bid on each player, right
					next to the amount. The live auction and a player's bid history still show only the
					amount, not who placed it. Bidding on a player linked to your own account is completely
					normal Calcutta behavior and isn't restricted in any way.
				</Accordion.Content>
			</Accordion.Item>

			<Accordion.Item value="notifications" class="border-brass/20">
				<Accordion.Trigger class="text-ink">How do I control email notifications?</Accordion.Trigger
				>
				<Accordion.Content class="text-ink/70">
					<p>
						Turn email notifications on or off, and choose which triggers you want to hear about —
						outbid, someone bid on you, a player you bid on got reserved, the live auction is
						starting, or you won a player — from the Settings page.
					</p>
					<a href={resolve('/settings/notifications')} class="font-medium text-fairway">
						Go to notification settings →
					</a>
				</Accordion.Content>
			</Accordion.Item>

			<Accordion.Item value="balance" class="border-brass/20">
				<Accordion.Trigger class="text-ink">Where do I see what I owe or am owed?</Accordion.Trigger
				>
				<Accordion.Content class="text-ink/70">
					See what you owe (players you won) and what you're owed (payouts for players you entered
					who placed), including which ones are already settled — from the "My balance" link on each
					tournament's own page.
				</Accordion.Content>
			</Accordion.Item>

			<Accordion.Item value="my-bids" class="border-brass/20">
				<Accordion.Trigger class="text-ink">Where do I see my own bid history?</Accordion.Trigger>
				<Accordion.Content class="text-ink/70">
					See every player you've bid on in a tournament, your own bid next to the current high, and
					whether you're leading, outbid, or the auction's already settled — from the "My bids" link
					on each tournament's own page.
				</Accordion.Content>
			</Accordion.Item>
		</Accordion.Root>
	</section>

	{#if isAdmin}
		<section class="flex flex-col gap-2 border-t border-brass/30 pt-6">
			{@render sectionLabel('Admin & Owner tools')}

			<Accordion.Root type="multiple" class="mt-1">
				<Accordion.Item value="importing-players" class="border-brass/20">
					<Accordion.Trigger class="text-ink"
						>How do I import a tournament roster?</Accordion.Trigger
					>
					<Accordion.Content class="text-ink/70">
						From a tournament's Players page, use "Import CSV" to preview and confirm a roster
						upload in one pass — flight, handicap, contact info, and (for CSV rows that email-match
						an existing account) the player-to-user link all come in together.
					</Accordion.Content>
				</Accordion.Item>

				<Accordion.Item value="tournament-settings" class="border-brass/20">
					<Accordion.Trigger class="text-ink"
						>What do tournament settings control?</Accordion.Trigger
					>
					<Accordion.Content class="text-ink/70">
						Each tournament's settings page controls the silent auction window, reservation
						threshold, minimum bid increment, minimum opening bid, anti-snipe timing, flights, and
						payout structure (the percentage of the pot each finishing place earns).
					</Accordion.Content>
				</Accordion.Item>

				<Accordion.Item value="running-live-auction" class="border-brass/20">
					<Accordion.Trigger class="text-ink">How do I run the live auction?</Accordion.Trigger>
					<Accordion.Content class="text-ink/70">
						Build and reorder the live auction queue — manual up/down, or one-click sorts by
						handicap or shuffle — from the tournament's Queue page, then open and advance lots one
						at a time from the Live Auction page. Each lot closes itself automatically once its
						anti-snipe countdown reaches zero; the "Close lot" button is still there for closing a
						lot early, e.g. once it's clear no one else is going to bid.
					</Accordion.Content>
				</Accordion.Item>

				<Accordion.Item value="voids-audit" class="border-brass/20">
					<Accordion.Trigger class="text-ink"
						>How do I fix a bad bid or look up what happened?</Accordion.Trigger
					>
					<Accordion.Content class="text-ink/70">
						<p>
							Void a bid with a required reason from a tournament's Bookkeeping page if it needs
							correcting (a duplicate click, a fat-fingered amount) — the void is logged, not
							silently deleted, and every state-changing action across the app (bids, voids, sales,
							role changes, and more) shows up in the searchable Audit log, filterable by player,
							actor, action, and date range.
						</p>
						<a href={resolve('/admin/audit')} class="font-medium text-fairway">
							Go to the audit log →
						</a>
					</Accordion.Content>
				</Accordion.Item>

				<Accordion.Item value="settling-up" class="border-brass/20">
					<Accordion.Trigger class="text-ink"
						>How do I settle up after the tournament?</Accordion.Trigger
					>
					<Accordion.Content class="text-ink/70">
						<p>
							Once the tournament wraps, enter each player's finishing place per flight/division
							from the tournament's Results page — this automatically calculates that flight's pot
							and each payout. From the Bookkeeping page, mark a winning bid as paid once the buyer
							settles up outside the app, and mark a payout as paid once you've sent a placement
							winner their share. Neither of these moves real money — they're just a record that it
							happened.
						</p>
						<a href={resolve('/admin/tournaments')} class="font-medium text-fairway">
							Go to tournaments →
						</a>
					</Accordion.Content>
				</Accordion.Item>

				<Accordion.Item value="export-winners" class="border-brass/20">
					<Accordion.Trigger class="text-ink"
						>How do I get a list of winners to share with participants?</Accordion.Trigger
					>
					<Accordion.Content class="text-ink/70">
						From a tournament's Bookkeeping page, use "Export CSV" to download a spreadsheet of
						every sold player — the winning bid amount and the buyer's name, email, and phone (if on
						file) — so you can share who bought whom with the league outside the app, including the
						contact info a golfer needs to negotiate a stake buy-back directly with their buyer.
					</Accordion.Content>
				</Accordion.Item>

				<Accordion.Item value="delete-tournament" class="border-brass/20">
					<Accordion.Trigger class="text-ink">Can I delete a tournament?</Accordion.Trigger>
					<Accordion.Content class="text-ink/70">
						Owner and Admin can both permanently delete a tournament from the tournaments list's
						Delete action, but only a dry-run tournament — used to rehearse a tournament setup —
						never a production tournament, whose bids, sales, and payouts are real financial history
						and are never deletable.
					</Accordion.Content>
				</Accordion.Item>

				<Accordion.Item value="owner-only" class="border-brass/20">
					<Accordion.Trigger class="text-ink">What can only the Owner do?</Accordion.Trigger>
					<Accordion.Content class="text-ink/70">
						<p>
							Only the Owner can promote a Participant to Admin or remove an Admin's access, from
							the Users page. Transferring ownership of the league to someone else is also
							Owner-level, but doesn't have a self-service button in the app yet — for now, that
							goes through a direct request rather than an in-app action.
						</p>
						<a href={resolve('/admin/users')} class="font-medium text-fairway"> Go to users → </a>
					</Accordion.Content>
				</Accordion.Item>
			</Accordion.Root>
		</section>
	{/if}
</div>
