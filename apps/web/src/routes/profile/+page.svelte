<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { initials } from '$lib/initials';
	import { formatUserName, isProfileComplete } from '$lib/profile';
	import { roleBadgeVariant } from '$lib/roles';

	let { data, form } = $props();
	let { profile } = $derived(data);
	let displayName = $derived(formatUserName(profile));

	let saving = $state(false);
</script>

<div class="mx-auto flex max-w-md flex-col gap-6 p-8">
	<PageHeader title="Profile" />

	{#if !isProfileComplete(profile)}
		<p class="text-sm text-ink/70">
			Add your first and last name below to continue — this is the only thing standing between you
			and the rest of the app.
		</p>
	{/if}

	<div class="flex items-center gap-4">
		<Avatar.Root size="lg">
			<Avatar.Image src={profile.avatar_url} alt={displayName ?? profile.email} />
			<Avatar.Fallback>{initials(displayName ?? profile.email)}</Avatar.Fallback>
		</Avatar.Root>

		<div class="flex flex-col gap-1">
			<p class="font-medium text-foreground">{displayName ?? '—'}</p>
			<p class="text-sm text-muted-foreground">{profile.email}</p>
			<Badge variant={roleBadgeVariant(profile.role)} class="w-fit">{profile.role}</Badge>
		</div>
	</div>

	<form
		method="POST"
		class="flex flex-col gap-4"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update();
				saving = false;
			};
		}}
	>
		{#if form?.error}
			<p class="text-sm text-destructive">{form.error}</p>
		{/if}

		<div class="flex flex-col gap-1.5">
			<Label for="first_name">First name</Label>
			<Input
				id="first_name"
				name="first_name"
				value={form?.first_name ?? profile.first_name ?? ''}
				required
				disabled={saving}
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="last_name">Last name</Label>
			<Input
				id="last_name"
				name="last_name"
				value={form?.last_name ?? profile.last_name ?? ''}
				required
				disabled={saving}
			/>
		</div>

		<Button type="submit" variant="brass" disabled={saving} class="self-start">
			{saving ? 'Saving…' : 'Save'}
		</Button>
	</form>
</div>
