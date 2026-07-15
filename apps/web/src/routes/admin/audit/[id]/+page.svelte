<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data } = $props();
	let { event } = $derived(data);

	const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3
	});

	function formatDateTime(iso: string): string {
		return dateTimeFormatter.format(new Date(iso));
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Audit event" eyebrow="Admin" />

	<div class="rounded-lg border border-brass/30 bg-scorecard p-6 text-ink">
		<dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
			<div>
				<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Time</dt>
				<dd class="mt-0.5">{formatDateTime(event.created_at)}</dd>
			</div>
			<div>
				<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Action</dt>
				<dd class="mt-0.5 font-data">{event.action}</dd>
			</div>
			<div>
				<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Entity</dt>
				<dd class="mt-0.5">{event.entity_type}{event.entity_id ? ` · ${event.entity_id}` : ''}</dd>
			</div>
			<div>
				<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Actor</dt>
				<dd class="mt-0.5">{event.actor_identity ?? '—'}</dd>
			</div>
			<div>
				<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Player</dt>
				<dd class="mt-0.5">{event.player_name ?? '—'}</dd>
			</div>
			<div>
				<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Tournament</dt>
				<dd class="mt-0.5">{event.tournament_name ?? '—'}</dd>
			</div>
			{#if event.reason}
				<div class="col-span-2">
					<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Reason</dt>
					<dd class="mt-0.5">{event.reason}</dd>
				</div>
			{/if}
			<div>
				<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">IP address</dt>
				<dd class="mt-0.5 font-data text-xs">{event.ip ?? '—'}</dd>
			</div>
			<div>
				<dt class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">User agent</dt>
				<dd class="mt-0.5 truncate text-xs" title={event.user_agent ?? undefined}>
					{event.user_agent ?? '—'}
				</dd>
			</div>
		</dl>

		{#if event.before !== null}
			<div class="mt-4">
				<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">Before</p>
				<pre
					class="mt-1 overflow-x-auto rounded border border-brass/30 bg-sand/20 p-3 text-xs">{JSON.stringify(
						event.before,
						null,
						2
					)}</pre>
			</div>
		{/if}
		{#if event.after !== null}
			<div class="mt-4">
				<p class="font-data text-[0.65rem] tracking-wider text-ink/60 uppercase">After</p>
				<pre
					class="mt-1 overflow-x-auto rounded border border-brass/30 bg-sand/20 p-3 text-xs">{JSON.stringify(
						event.after,
						null,
						2
					)}</pre>
			</div>
		{/if}
	</div>
</div>
