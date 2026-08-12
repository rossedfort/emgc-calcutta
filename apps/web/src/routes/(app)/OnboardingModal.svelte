<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { needsNameConfirmation, type UserProfile } from '$lib/profile';
	import { routes } from '$lib/routes';

	let {
		profile,
		notificationsSetupPending
	}: { profile: UserProfile; notificationsSetupPending: boolean } = $props();

	// Frozen at mount, not reactive — the total step count shouldn't shrink
	// just because the first step gets completed while this modal is still
	// open showing the second (this component instance persists across both
	// steps; see +page.svelte, which renders it unconditionally rather than
	// behind an {#if}).
	const initialNameConfirmationPending = untrack(() => needsNameConfirmation(profile));
	const totalSteps =
		(initialNameConfirmationPending ? 1 : 0) + (untrack(() => notificationsSetupPending) ? 1 : 0);

	// These two *do* need to stay reactive — completing one step (via
	// use:enhance's update() below, which invalidates root layout's load)
	// is what advances currentStep to the next one, or clears it to null
	// (closing the modal) once both are done. Always shows the name step at
	// least once — needsNameConfirmation checks name_confirmed_at, not
	// whether first_name/last_name happen to already be populated, so an
	// OAuth sign-in that auto-filled both from the identity provider still
	// gets a chance to review/correct them here.
	let nameConfirmationPending = $derived(needsNameConfirmation(profile));
	let currentStep = $derived(
		nameConfirmationPending ? 'profile' : notificationsSetupPending ? 'notifications' : null
	);
	let stepIndex = $derived(currentStep === 'profile' ? 1 : initialNameConfirmationPending ? 2 : 1);

	// --- Profile step ---
	// Seeded once from the initial props, deliberately not reactively (see
	// settings/notifications/+page.svelte's own identical `untrack` usage) —
	// re-deriving on every `profile` change would clobber whatever the user
	// is mid-edit on.
	let firstName = $state(untrack(() => profile.first_name ?? ''));
	let lastName = $state(untrack(() => profile.last_name ?? ''));
	let profileSaving = $state(false);
	let profileError = $state('');

	// --- Notifications step ---
	// This step only ever renders when no notification_prefs row exists yet
	// (that's what notificationsSetupPending means), so these defaults —
	// mirroring settings/notifications/+page.server.ts's own DEFAULT_PREFS —
	// are always the correct starting point; no query needed to pre-fill.
	let emailEnabled = $state(false);
	let outbid = $state(true);
	let bidOnYou = $state(true);
	let reserved = $state(true);
	let liveStarting = $state(true);
	let won = $state(true);
	let notificationsSaving = $state(false);
	let notificationsError = $state('');

	const TRIGGERS: {
		name: string;
		label: string;
		description: string;
		get checked(): boolean;
		set checked(value: boolean);
	}[] = [
		{
			name: 'outbid',
			label: 'Outbid',
			description: "Someone else's bid beats your current high bid on a player.",
			get checked() {
				return outbid;
			},
			set checked(value) {
				outbid = value;
			}
		},
		{
			name: 'bid_on_you',
			label: 'Bid on you',
			description: 'Someone places a bid on the player linked to your account.',
			get checked() {
				return bidOnYou;
			},
			set checked(value) {
				bidOnYou = value;
			}
		},
		{
			name: 'reserved',
			label: 'Player reserved',
			description: "A player you've bid on crosses the threshold and moves to the live auction.",
			get checked() {
				return reserved;
			},
			set checked(value) {
				reserved = value;
			}
		},
		{
			name: 'live_starting',
			label: 'Live auction starting',
			description: 'The live event opens, for tournaments where you have a reserved player.',
			get checked() {
				return liveStarting;
			},
			set checked(value) {
				liveStarting = value;
			}
		},
		{
			name: 'won',
			label: 'Lot won',
			description: 'Your bid wins a player, in the silent or live auction.',
			get checked() {
				return won;
			},
			set checked(value) {
				won = value;
			}
		}
	];
</script>

{#if currentStep}
	<Dialog.Root open={true} onOpenChange={() => {}}>
		<Dialog.Content
			showCloseButton={false}
			escapeKeydownBehavior="ignore"
			interactOutsideBehavior="ignore"
			class="sm:max-w-md"
		>
			<Dialog.Header>
				{#if totalSteps > 1}
					<p class="font-data text-xs tracking-widest text-brass uppercase">
						Step {stepIndex} of {totalSteps}
					</p>
				{/if}
				{#if currentStep === 'profile'}
					<Dialog.Title>Confirm your name</Dialog.Title>
					<Dialog.Description>
						Shown to other Participants and the auctioneer during the live event.
					</Dialog.Description>
				{:else}
					<Dialog.Title>Notification preferences</Dialog.Title>
					<Dialog.Description>
						Choose which auction emails you'd like — you can change this later in Settings.
					</Dialog.Description>
				{/if}
			</Dialog.Header>

			{#if currentStep === 'profile'}
				<form
					method="POST"
					action="{routes.profile()}?/updateProfile"
					class="flex flex-col gap-4"
					use:enhance={() => {
						profileSaving = true;
						profileError = '';
						return async ({ result, update }) => {
							profileSaving = false;
							if (result.type === 'failure') {
								profileError = (result.data?.error as string) ?? 'Something went wrong.';
							}
							await update();
						};
					}}
				>
					{#if profileError}
						<p class="text-sm text-destructive">{profileError}</p>
					{/if}
					<div class="flex flex-col gap-1.5">
						<Label for="onboarding_first_name">First name</Label>
						<Input
							id="onboarding_first_name"
							name="first_name"
							bind:value={firstName}
							required
							disabled={profileSaving}
						/>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="onboarding_last_name">Last name</Label>
						<Input
							id="onboarding_last_name"
							name="last_name"
							bind:value={lastName}
							required
							disabled={profileSaving}
						/>
					</div>
					<Dialog.Footer>
						<Button type="submit" variant="brass" disabled={profileSaving}>
							{profileSaving ? 'Saving…' : totalSteps > 1 ? 'Continue' : 'Finish setup'}
						</Button>
					</Dialog.Footer>
				</form>
			{:else}
				<form
					method="POST"
					action={routes.settingsNotifications()}
					class="flex flex-col gap-4"
					use:enhance={() => {
						notificationsSaving = true;
						notificationsError = '';
						return async ({ result, update }) => {
							notificationsSaving = false;
							if (result.type === 'failure') {
								notificationsError = (result.data?.error as string) ?? 'Something went wrong.';
							}
							await update();
						};
					}}
				>
					{#if notificationsError}
						<p class="text-sm text-destructive">{notificationsError}</p>
					{/if}

					<div
						class="flex items-center justify-between rounded-lg border border-brass/30 bg-scorecard p-4"
					>
						<div class="flex flex-col gap-0.5">
							<Label for="onboarding_email_enabled">Email notifications</Label>
							<p class="text-sm text-muted-foreground">
								Turn off to stay opted out of every notification below.
							</p>
						</div>
						<Switch
							id="onboarding_email_enabled"
							name="email_enabled"
							bind:checked={emailEnabled}
						/>
					</div>

					<div class="flex flex-col gap-3 rounded-lg border border-brass/30 bg-scorecard p-4">
						{#each TRIGGERS as trigger (trigger.name)}
							<div class="flex items-center justify-between gap-4">
								<div class="flex flex-col gap-0.5">
									<Label for="onboarding_{trigger.name}">{trigger.label}</Label>
									<p class="text-sm text-muted-foreground">{trigger.description}</p>
								</div>
								<Switch
									id="onboarding_{trigger.name}"
									name={trigger.name}
									bind:checked={trigger.checked}
									disabled={!emailEnabled}
								/>
							</div>
						{/each}
					</div>

					<Dialog.Footer>
						<Button type="submit" variant="brass" disabled={notificationsSaving}>
							{notificationsSaving ? 'Saving…' : 'Finish setup'}
						</Button>
					</Dialog.Footer>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
{/if}
