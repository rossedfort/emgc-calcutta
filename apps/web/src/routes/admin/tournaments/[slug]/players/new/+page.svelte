<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import PlayerForm from '../PlayerForm.svelte';
	import type { PlayerFormValues } from '../shared';

	let { data, form } = $props();

	const emptyValues: PlayerFormValues = {
		first_name: '',
		last_name: '',
		contact_email: '',
		contact_phone: '',
		flight: '',
		handicap_index: '',
		preferences: ''
	};
</script>

<div class="flex flex-col gap-4 pt-4">
	<PageHeader title="New player">
		{#snippet actions()}
			<a
				href={resolve('/admin/tournaments/[slug]/players', { slug: data.tournament.slug })}
				class="text-sm text-brass hover:underline">Cancel</a
			>
		{/snippet}
	</PageHeader>

	<form method="POST" use:enhance>
		<PlayerForm
			values={(form?.values as PlayerFormValues | undefined) ?? emptyValues}
			errors={form?.errors ?? {}}
			submitLabel="Add player"
		/>
	</form>
</div>
