<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
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
		silent_auction_start: toLocalInput(data.tournament.silent_auction_start),
		silent_auction_end: toLocalInput(data.tournament.silent_auction_end),
		threshold_amount: String(data.tournament.threshold_amount),
		min_increment: String(data.tournament.min_increment),
		anti_snipe_seconds: String(data.tournament.anti_snipe_seconds)
	});

	let defaultPayoutRows = $derived<PayoutRow[]>(
		Object.entries(data.tournament.payout_structure).map(([place, percent]) => ({
			place,
			percent: String(percent * 100)
		}))
	);
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-medium text-foreground">Edit tournament</h2>
		<a href={resolve('/admin/tournaments')} class="text-sm text-muted-foreground hover:underline"
			>Cancel</a
		>
	</div>

	<form method="POST" use:enhance>
		<TournamentForm
			values={(form?.values as TournamentFormValues | undefined) ?? defaultValues}
			payoutRows={defaultPayoutRows}
			errors={form?.errors ?? {}}
			submitLabel="Save changes"
		/>
	</form>
</div>
