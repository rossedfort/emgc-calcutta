<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import PlayerForm from '../../PlayerForm.svelte';
	import type { PlayerFormValues } from '../../shared';

	let { data, form } = $props();

	let errorMessage = $derived(form && 'error' in form ? (form.error as string) : null);

	let defaultValues = $derived<PlayerFormValues>({
		name: data.player.name,
		contact_email: data.player.contact_email ?? '',
		contact_phone: data.player.contact_phone ?? '',
		flight: data.player.flight,
		handicap_index: data.player.handicap_index !== null ? String(data.player.handicap_index) : '',
		preferences: data.player.preferences ?? ''
	});

	let linkSubmitting = $state(false);
	let unlinkSubmitting = $state(false);
	let showRemoveConfirm = $state(false);
	let removeSubmitting = $state(false);
</script>

<div class="flex flex-col gap-4 pt-4">
	<PageHeader title={data.player.name}>
		{#snippet actions()}
			<a
				href={resolve('/admin/tournaments/[slug]/players', { slug: data.tournament.slug })}
				class="text-sm text-brass hover:underline">Back to players</a
			>
		{/snippet}
	</PageHeader>

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	<form method="POST" action="?/updateDetails" use:enhance>
		<PlayerForm
			values={(form && 'values' in form
				? (form.values as PlayerFormValues | undefined)
				: undefined) ?? defaultValues}
			errors={form && 'errors' in form ? (form.errors as Record<string, string>) : {}}
			submitLabel="Save changes"
		/>
	</form>

	<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
		<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Status</p>
		<p class="font-data mt-1 text-sm">{data.player.status}</p>

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

	<div class="border-t border-destructive/30 pt-4">
		{#if !showRemoveConfirm}
			<Button variant="destructive" size="sm" onclick={() => (showRemoveConfirm = true)}>
				Remove player
			</Button>
		{:else}
			<div class="flex items-center gap-2">
				<p class="text-sm text-destructive">Remove {data.player.name}? This can't be undone.</p>
				<form
					method="POST"
					action="?/remove"
					use:enhance={() => {
						removeSubmitting = true;
						return async ({ update }) => {
							await update();
							removeSubmitting = false;
						};
					}}
				>
					<Button type="submit" variant="destructive" size="sm" disabled={removeSubmitting}>
						{removeSubmitting ? 'Removing…' : 'Yes, remove'}
					</Button>
				</form>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={removeSubmitting}
					onclick={() => (showRemoveConfirm = false)}
				>
					Cancel
				</Button>
			</div>
		{/if}
	</div>
</div>
