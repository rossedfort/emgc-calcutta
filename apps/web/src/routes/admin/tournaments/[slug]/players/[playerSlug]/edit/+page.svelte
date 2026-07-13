<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data, form } = $props();

	let errorMessage = $derived(form && 'error' in form ? (form.error as string) : null);

	let linkSubmitting = $state(false);
	let unlinkSubmitting = $state(false);
</script>

<div class="flex flex-col gap-4">
	<PageHeader title={data.player.name} eyebrow="Admin">
		{#snippet actions()}
			<a href={resolve('/admin/tournaments')} class="text-sm text-brass hover:underline"
				>Back to tournaments</a
			>
		{/snippet}
	</PageHeader>

	<p class="font-data text-xs tracking-widest text-fairway uppercase">{data.tournament.name}</p>

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
		<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="text-ink/60">Contact email</dt>
			<dd>{data.player.contact_email ?? '—'}</dd>
			<dt class="text-ink/60">Contact phone</dt>
			<dd>{data.player.contact_phone ?? '—'}</dd>
			<dt class="text-ink/60">Flight</dt>
			<dd>{data.player.flight ?? '—'}</dd>
			<dt class="text-ink/60">Status</dt>
			<dd class="font-data">{data.player.status}</dd>
		</dl>

		<div class="mt-4 border-t border-brass/40"></div>

		<div class="mt-4 flex flex-col gap-2">
			<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">
				Linked participant
			</p>

			{#if data.linkedUser}
				<div class="flex items-center gap-3">
					<p class="text-sm">
						{data.linkedUser.name ?? data.linkedUser.email}
						{#if data.linkedUser.name}<span class="text-ink/60">({data.linkedUser.email})</span
							>{/if}
					</p>
					<form
						method="POST"
						action="?/unlink"
						use:enhance={() => {
							unlinkSubmitting = true;
							return async ({ update }) => {
								await update();
								unlinkSubmitting = false;
							};
						}}
					>
						<Button type="submit" variant="destructive" size="sm" disabled={unlinkSubmitting}>
							{unlinkSubmitting ? 'Unlinking…' : 'Unlink'}
						</Button>
					</form>
				</div>
			{:else}
				<p class="text-sm text-ink/70">
					Not linked to a participant — this competitor can't bid unless linked.
				</p>
				<form
					method="POST"
					action="?/link"
					class="flex items-center gap-2"
					use:enhance={() => {
						linkSubmitting = true;
						return async ({ update }) => {
							await update();
							linkSubmitting = false;
						};
					}}
				>
					<select
						name="userId"
						required
						disabled={linkSubmitting}
						class="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
					>
						<option value="" disabled selected>Choose a participant</option>
						{#each data.users as user (user.id)}
							<option value={user.id}
								>{user.name ? `${user.name} (${user.email})` : user.email}</option
							>
						{/each}
					</select>
					<Button type="submit" variant="brass" size="sm" disabled={linkSubmitting}>
						{linkSubmitting ? 'Linking…' : 'Link'}
					</Button>
				</form>
			{/if}
		</div>
	</div>
</div>
