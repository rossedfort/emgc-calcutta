<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { routes } from '$lib/routes';
	import TournamentForm from '../../TournamentForm.svelte';
	import type { PayoutRow, TournamentFormValues } from '../../shared';

	let { data, form } = $props();

	// datetime-local inputs want "YYYY-MM-DDTHH:mm" in the browser's local
	// time, not toISOString()'s UTC — this app doesn't otherwise deal with
	// multi-timezone concerns (spec assumes a single in-person league), so a
	// straightforward local-time round-trip is enough for now.
	function toLocalInput(iso: string) {
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	let defaultValues = $derived<TournamentFormValues>({
		name: data.tournament.name,
		kind: data.tournament.kind,
		silent_auction_start: toLocalInput(data.tournament.silent_auction_start),
		silent_auction_end: toLocalInput(data.tournament.silent_auction_end),
		threshold_amount: String(data.tournament.threshold_amount),
		min_increment: String(data.tournament.min_increment),
		minimum_bid: String(data.tournament.minimum_bid),
		anti_snipe_seconds: String(data.tournament.anti_snipe_seconds),
		championship_flight: data.tournament.championship_flight ?? '',
		// Stored as a 0-1 fraction, shown as a whole-number percentage —
		// same convention payout_structure's own rows already use.
		buy_back_percentage:
			data.tournament.buy_back_percentage !== null
				? String(data.tournament.buy_back_percentage * 100)
				: '',
		event_start_at: data.tournament.event_start_at
			? toLocalInput(data.tournament.event_start_at)
			: '',
		bid_anonymity_enabled: data.tournament.bid_anonymity_enabled
	});

	let defaultPayoutRows = $derived<PayoutRow[]>(
		Object.entries(data.tournament.payout_structure).map(([place, percent]) => ({
			place,
			percent: String(percent * 100)
		}))
	);
</script>

<div class="flex max-w-3xl flex-col gap-4 pt-4">
	<PageHeader title="Edit tournament">
		{#snippet actions()}
			<a
				href={routes.adminTournament(data.tournament.slug)}
				class="text-sm text-brass hover:underline">Cancel</a
			>
		{/snippet}
	</PageHeader>

	<form method="POST" use:enhance>
		<TournamentForm
			values={(form?.values as TournamentFormValues | undefined) ?? defaultValues}
			payoutRows={defaultPayoutRows}
			flights={data.tournament.flights}
			errors={form?.errors ?? {}}
			submitLabel="Save changes"
		/>
	</form>
</div>
