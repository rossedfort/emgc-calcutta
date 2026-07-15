<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data, form } = $props();

	// Seeds editable local state from the initial load (or the previous
	// submission's echoed-back values) once, deliberately not reactively —
	// re-deriving on every `data`/`form` change would clobber whatever the
	// user is mid-edit on. `untrack` is the correct way to read a reactive
	// value for a one-time initializer without Svelte flagging it as an
	// accidental non-reactive read.
	const initialPrefs = untrack(() => form?.prefs ?? data.prefs);

	let emailEnabled = $state(initialPrefs.email_enabled);
	let outbid = $state(initialPrefs.outbid);
	let bidOnYou = $state(initialPrefs.bid_on_you);
	let reserved = $state(initialPrefs.reserved);
	let liveStarting = $state(initialPrefs.live_starting);
	let won = $state(initialPrefs.won);

	let saving = $state(false);

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

<div class="mx-auto flex max-w-2xl flex-col gap-4">
	<PageHeader title="Notification settings" eyebrow="Settings" />

	<form
		method="POST"
		class="flex flex-col gap-6"
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
		{:else if form?.success}
			<p class="text-sm text-fairway">Saved.</p>
		{/if}

		<div
			class="flex items-center justify-between rounded-lg border border-brass/30 bg-scorecard p-4"
		>
			<div class="flex flex-col gap-0.5">
				<Label for="email_enabled">Email notifications</Label>
				<p class="text-sm text-muted-foreground">
					Turn off to stop all notification emails, regardless of the toggles below.
				</p>
			</div>
			<Switch id="email_enabled" name="email_enabled" bind:checked={emailEnabled} />
		</div>

		<div class="flex flex-col gap-4 rounded-lg border border-brass/30 bg-scorecard p-4">
			{#each TRIGGERS as trigger (trigger.name)}
				<div class="flex items-center justify-between gap-4">
					<div class="flex flex-col gap-0.5">
						<Label for={trigger.name}>{trigger.label}</Label>
						<p class="text-sm text-muted-foreground">{trigger.description}</p>
					</div>
					<Switch
						id={trigger.name}
						name={trigger.name}
						bind:checked={trigger.checked}
						disabled={!emailEnabled}
					/>
				</div>
			{/each}
		</div>

		<Button type="submit" variant="brass" disabled={saving} class="self-start">
			{saving ? 'Saving…' : 'Save changes'}
		</Button>
	</form>
</div>
