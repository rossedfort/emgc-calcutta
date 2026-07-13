<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { initials } from '$lib/initials';
	import { roleBadgeVariant } from '$lib/roles';

	let { data } = $props();
	let { profile } = $derived(data);
</script>

<div class="mx-auto flex max-w-md flex-col gap-6 p-8">
	<h2 class="text-lg font-medium text-foreground">Profile</h2>

	<div class="flex items-center gap-4">
		<Avatar.Root size="lg">
			<Avatar.Image src={profile.avatar_url} alt={profile.name ?? profile.email} />
			<Avatar.Fallback>{initials(profile.name ?? profile.email)}</Avatar.Fallback>
		</Avatar.Root>

		<div class="flex flex-col gap-1">
			<p class="font-medium text-foreground">{profile.name ?? '—'}</p>
			<p class="text-sm text-muted-foreground">{profile.email}</p>
			<Badge variant={roleBadgeVariant(profile.role)} class="w-fit">{profile.role}</Badge>
		</div>
	</div>
</div>
