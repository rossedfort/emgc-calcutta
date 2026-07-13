<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import TournamentForm from '../TournamentForm.svelte';
	import type { TournamentFormValues } from '../shared';

	let { form } = $props();

	const emptyValues: TournamentFormValues = {
		name: '',
		silent_auction_start: '',
		silent_auction_end: '',
		threshold_amount: '',
		min_increment: '',
		anti_snipe_seconds: '15'
	};
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-medium text-foreground">New tournament</h2>
		<a href={resolve('/admin/tournaments')} class="text-sm text-muted-foreground hover:underline"
			>Cancel</a
		>
	</div>

	<form method="POST" use:enhance>
		<TournamentForm
			values={(form?.values as TournamentFormValues | undefined) ?? emptyValues}
			payoutRows={[]}
			errors={form?.errors ?? {}}
			submitLabel="Create tournament"
		/>
	</form>
</div>
