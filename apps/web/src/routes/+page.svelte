<script lang="ts">
	let { data } = $props();
</script>

<div class="flex flex-col gap-2">
	<h1 class="text-2xl font-semibold text-foreground">emgc-calcutta</h1>
	<p class="text-muted-foreground">Signed in as {data.session?.user.email}</p>
</div>
