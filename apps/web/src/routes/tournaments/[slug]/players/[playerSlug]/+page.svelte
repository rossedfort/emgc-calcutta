<script lang="ts">
	import { resolve } from '$app/paths';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { formatPlayerName, playerStatusBadgeVariant, playerStatusLabel } from '$lib/players';

	let { data } = $props();
</script>

<div class="flex flex-col gap-4">
	<PageHeader title={formatPlayerName(data.player)}>
		{#snippet actions()}
			<a
				href={resolve('/tournaments/[slug]', { slug: data.tournament.slug })}
				class="text-sm text-brass hover:underline">Back to players</a
			>
		{/snippet}
	</PageHeader>

	<p class="font-data text-xs tracking-widest text-fairway uppercase">{data.tournament.name}</p>

	<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
		<div class="flex items-center gap-2">
			<Badge variant={playerStatusBadgeVariant(data.player.status)}>
				{playerStatusLabel(data.player.status)}
			</Badge>
			<DivisionBadge division={data.player.division} />
			{#if data.isYou}
				<Badge variant="brass">This is you</Badge>
			{:else if data.player.user_id}
				<Badge variant="fairway">
					Linked{data.linkedUserName ? ` · ${data.linkedUserName}` : ' to a participant'}
				</Badge>
			{/if}
		</div>

		<div class="mt-4 border-t border-brass/40"></div>

		<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="text-ink/60">Flight</dt>
			<dd>{data.player.flight || '—'}</dd>
			<dt class="text-ink/60">Handicap</dt>
			<dd class="font-data">{data.player.handicap_index ?? '—'}</dd>
			<dt class="text-ink/60">Contact email</dt>
			<dd>{data.player.contact_email ?? '—'}</dd>
			<dt class="text-ink/60">Contact phone</dt>
			<dd>{data.player.contact_phone ?? '—'}</dd>
			<dt class="text-ink/60">Preferences</dt>
			<dd>{data.player.preferences ?? '—'}</dd>
		</dl>

		<div class="mt-4 border-t border-brass/40"></div>

		<div class="mt-4 flex flex-col gap-1">
			<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Bid history</p>
			<p class="text-sm text-ink/70">No bids placed yet.</p>
		</div>
	</div>
</div>
