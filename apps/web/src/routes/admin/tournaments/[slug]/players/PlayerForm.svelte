<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { PlayerFormValues } from './shared';

	interface Props {
		values: PlayerFormValues;
		errors: Record<string, string>;
		submitLabel: string;
	}

	let { values, errors, submitLabel }: Props = $props();
</script>

<div class="flex flex-col gap-4">
	{#if errors.form}
		<p class="text-sm text-destructive">{errors.form}</p>
	{/if}

	<div class="flex flex-col gap-1.5">
		<Label for="name">Name</Label>
		<Input id="name" name="name" value={values.name} />
		{#if errors.name}<p class="text-sm text-destructive">{errors.name}</p>{/if}
	</div>

	<div class="grid grid-cols-2 gap-4">
		<div class="flex flex-col gap-1.5">
			<Label for="contact_email">Contact email</Label>
			<Input id="contact_email" name="contact_email" type="email" value={values.contact_email} />
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="contact_phone">Contact phone</Label>
			<Input id="contact_phone" name="contact_phone" value={values.contact_phone} />
		</div>
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="flight">Flight</Label>
		<Input id="flight" name="flight" class="max-w-40" value={values.flight} />
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="preferences">Preferences</Label>
		<Input id="preferences" name="preferences" value={values.preferences} />
	</div>

	<Button type="submit" variant="brass" class="w-fit">{submitLabel}</Button>
</div>
