<script lang="ts">
	import { enhance } from '$app/forms';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import TournamentForm from '../TournamentForm.svelte';
	import {
		statusBadgeVariant,
		type PayoutRow,
		type Tournament,
		type TournamentFormValues
	} from '../shared';

	let { data, form } = $props();

	const statuses: Tournament['status'][] = ['setup', 'active', 'complete'];

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
		anti_snipe_seconds: String(data.tournament.anti_snipe_seconds)
	});

	let defaultPayoutRows = $derived<PayoutRow[]>(
		Object.entries(data.tournament.payout_structure).map(([place, percent]) => ({
			place,
			percent: String(percent * 100)
		}))
	);
</script>

<div class="flex flex-col gap-4 pt-4">
	<div class="flex flex-col gap-2">
		<div class="flex items-center gap-2">
			<span class="text-sm text-muted-foreground">Status</span>
			{#each statuses as status (status)}
				{#if status === data.tournament.status}
					<Badge variant={statusBadgeVariant(status)}>{status}</Badge>
				{:else}
					<form method="POST" action="?/setStatus" use:enhance>
						<input type="hidden" name="status" value={status} />
						<Button type="submit" variant="brass" size="sm">Mark {status}</Button>
					</form>
				{/if}
			{/each}
		</div>
		{#if form?.statusError}
			<p class="text-sm text-destructive">{form.statusError}</p>
		{/if}
	</div>

	<div class="flex flex-col gap-2 rounded-lg border border-brass/30 bg-scorecard p-4">
		<span class="text-sm text-muted-foreground">Live auction</span>
		{#if data.tournament.live_auction_started_at}
			<div class="flex items-center gap-2">
				<Badge variant="fairway">Started</Badge>
				<span class="text-sm text-ink/70">
					{new Date(data.tournament.live_auction_started_at).toLocaleString()}
				</span>
			</div>
		{:else}
			<div class="flex items-center gap-2">
				<form method="POST" action="?/startLiveAuction" use:enhance>
					<Button
						type="submit"
						variant="brass"
						size="sm"
						disabled={new Date(data.tournament.silent_auction_end) > new Date()}
					>
						Start live auction
					</Button>
				</form>
				{#if new Date(data.tournament.silent_auction_end) > new Date()}
					<span class="text-xs text-ink/60">
						Available once the silent auction ends ({new Date(
							data.tournament.silent_auction_end
						).toLocaleString()})
					</span>
				{/if}
			</div>
		{/if}
		{#if form?.liveAuctionError}
			<p class="text-sm text-destructive">{form.liveAuctionError}</p>
		{/if}
	</div>

	<form method="POST" action="?/updateSettings" use:enhance>
		<TournamentForm
			values={(form?.values as TournamentFormValues | undefined) ?? defaultValues}
			payoutRows={defaultPayoutRows}
			errors={form?.errors ?? {}}
			submitLabel="Save changes"
		/>
	</form>
</div>
