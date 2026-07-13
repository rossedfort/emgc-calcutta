<script lang="ts">
	let { children } = $props();
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4">
	{@render children()}
</div>
