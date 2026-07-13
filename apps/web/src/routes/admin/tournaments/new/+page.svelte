<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import TournamentForm from '../TournamentForm.svelte';
	import type { TournamentFormValues } from '../shared';

	let { form } = $props();

	const emptyValues: TournamentFormValues = {
		name: '',
		kind: 'production',
		silent_auction_start: '',
		silent_auction_end: '',
		threshold_amount: '',
		min_increment: '',
		anti_snipe_seconds: '15'
	};
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="New tournament" eyebrow="Admin">
		{#snippet actions()}
			<a href={resolve('/admin/tournaments')} class="text-sm text-brass hover:underline">Cancel</a>
		{/snippet}
	</PageHeader>

	<form method="POST" use:enhance>
		<TournamentForm
			values={(form?.values as TournamentFormValues | undefined) ?? emptyValues}
			payoutRows={[]}
			errors={form?.errors ?? {}}
			submitLabel="Create tournament"
		/>
	</form>
</div>
