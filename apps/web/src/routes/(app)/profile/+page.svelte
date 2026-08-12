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
	import { routes } from '$lib/routes';

	let { data, form } = $props();
	let { profile, linkedTournaments } = $derived(data);
	let displayName = $derived(formatUserName(profile));

	let saving = $state(false);

	// Per-row state — unlinking one tournament shouldn't disable the others.
	let unlinkingPlayerId = $state<string | null>(null);
	let unlinkError = $state('');
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
		action="?/updateProfile"
		class="flex flex-col gap-4"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update();
				saving = false;
			};
		}}
	>
		{#if form && 'error' in form && form.error}
			<p class="text-sm text-destructive">{form.error}</p>
		{/if}

		<div class="flex flex-col gap-1.5">
			<Label for="first_name">First name</Label>
			<Input
				id="first_name"
				name="first_name"
				value={(form && 'first_name' in form ? form.first_name : null) ?? profile.first_name ?? ''}
				required
				disabled={saving}
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="last_name">Last name</Label>
			<Input
				id="last_name"
				name="last_name"
				value={(form && 'last_name' in form ? form.last_name : null) ?? profile.last_name ?? ''}
				required
				disabled={saving}
			/>
		</div>

		<Button type="submit" variant="brass" disabled={saving} class="self-start">
			{saving ? 'Saving…' : 'Save'}
		</Button>
	</form>

	<div class="flex flex-col gap-2 border-t border-brass/30 pt-6">
		<h3 class="font-display text-base font-semibold text-ink">Tournaments</h3>
		{#if linkedTournaments.length === 0}
			<p class="text-sm text-ink/70">You're not linked to a player in any tournament yet.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each linkedTournaments as linked (linked.playerId)}
					<li
						class="flex items-center justify-between gap-3 rounded-lg border border-brass/30 bg-scorecard p-3"
					>
						<div class="flex flex-col gap-0.5">
							<a
								href={routes.tournament(linked.tournamentSlug)}
								class="text-sm font-medium text-ink hover:underline"
							>
								{linked.tournamentName}
							</a>
							<p class="text-xs text-muted-foreground">Linked as {linked.playerName}</p>
						</div>
						<form
							method="POST"
							action="?/unlink"
							use:enhance={() => {
								unlinkingPlayerId = linked.playerId;
								unlinkError = '';
								return async ({ result, update }) => {
									if (result.type === 'failure' && result.data && 'unlinkError' in result.data) {
										unlinkError = result.data.unlinkError as string;
									}
									await update();
									unlinkingPlayerId = null;
								};
							}}
						>
							<input type="hidden" name="playerId" value={linked.playerId} />
							<Button
								type="submit"
								variant="destructive"
								size="sm"
								disabled={unlinkingPlayerId === linked.playerId}
							>
								{unlinkingPlayerId === linked.playerId ? 'Leaving...' : 'Leave'}
							</Button>
						</form>
					</li>
				{/each}
			</ul>
			{#if unlinkError}
				<p class="text-sm text-destructive">{unlinkError}</p>
			{/if}
		{/if}
	</div>
</div>
