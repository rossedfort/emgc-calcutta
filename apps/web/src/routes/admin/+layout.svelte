<script lang="ts">
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-foreground">Admin</h1>
		<a href={resolve('/')} class="text-sm text-muted-foreground hover:underline">Back to app</a>
	</div>

	{@render children()}
</div>
