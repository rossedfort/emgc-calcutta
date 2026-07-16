<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		division: string;
	}

	let { division }: Props = $props();
</script>

{#if division === 'gross'}
	<Badge variant="brass">Gross</Badge>
{:else if division === 'net'}
	<Badge variant="sand">Net</Badge>
{/if}
