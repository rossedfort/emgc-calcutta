<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		division: string;
		// 'lg' is for TV displays (LiveAuctionTVBoard/SilentAuctionTVBoard) —
		// the base Badge primitive has no size variant of its own (just
		// color), so this stays a call-site class override here rather than
		// touching the vendored ui/badge component.
		size?: 'sm' | 'lg';
	}

	let { division, size = 'sm' }: Props = $props();

	let sizeClass = $derived(size === 'lg' ? 'h-7 px-3 text-sm' : '');
</script>

{#if division === 'gross'}
	<Badge variant="brass" class={sizeClass}>Gross</Badge>
{:else if division === 'net'}
	<Badge variant="sand" class={sizeClass}>Net</Badge>
{/if}
