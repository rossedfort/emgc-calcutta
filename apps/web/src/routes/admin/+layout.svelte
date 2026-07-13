<script lang="ts">
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-foreground">Admin</h1>
		<a href={resolve('/')} class="text-sm text-muted-foreground hover:underline">Back to app</a>
	</div>

	<nav class="flex gap-4 border-b pb-2 text-sm">
		<a href={resolve('/admin/users')} class="text-muted-foreground hover:text-foreground">Users</a>
		<a href={resolve('/admin/tournaments')} class="text-muted-foreground hover:text-foreground"
			>Tournament</a
		>
	</nav>

	{@render children()}
</div>
