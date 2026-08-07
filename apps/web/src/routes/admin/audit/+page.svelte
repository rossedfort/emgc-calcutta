<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { navigating, page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import { AUDIT_ACTIONS, auditActionLabel, type AuditEventRow } from '$lib/auditActions';
	import { createAuditRealtime, type AuditRealtime } from '$lib/stores/auditRealtime';
	import type { RealtimeConnectionStatus } from '$lib/stores/realtime';

	let { data } = $props();

	// The From/To datetime-local inputs below submit a raw "YYYY-MM-DDTHH:mm"
	// string with no timezone of its own — parseAuditFilters/queryAuditEvents
	// need this browser's own offset to convert it to the correct UTC
	// instant (see $lib/time.ts's localDateTimeToUtcIso). Computed once, not
	// reactively: the browser's own timezone doesn't change mid-session.
	const tzOffsetMinutes = new Date().getTimezoneOffset();

	// Carries whatever filters are currently applied — export reflects the
	// current view, not just the 200 rows shown on screen (the export
	// endpoint itself re-runs the same filtered query uncapped).
	let exportHref = $derived(`${resolve('/admin/audit/export')}${page.url.search}`);

	// The filter form is a plain GET, so re-querying is a real SvelteKit
	// navigation (re-running this route's server `load`) rather than a
	// fetch this component kicks off itself — `navigating` is the only
	// signal available for it. Scoped to "navigating to this same route"
	// so the indicator doesn't flash while leaving the page entirely.
	let isQuerying = $derived(navigating.to?.route.id === page.route.id);

	let filtersActive = $derived(
		Boolean(
			data.filters.participant ||
			data.filters.player ||
			data.filters.tournament ||
			data.filters.action ||
			data.filters.start ||
			data.filters.end
		)
	);

	// Live mode only makes sense against the unfiltered view: postgres_changes
	// can't apply this page's text-match/date-range filters server-side, and
	// re-implementing them client-side against every new event would be real
	// complexity for a live-tail convenience feature — so the toggle is
	// simply unavailable while a filter is active, rather than risking an
	// unfiltered event sneaking into a filtered view.
	let rt: AuditRealtime | null = null;
	let unsubEvents: (() => void) | null = null;
	let unsubConnection: (() => void) | null = null;
	let liveEnabled = $state(false);
	let liveEvents = $state<AuditEventRow[]>([]);
	let connectionStatus = $state<RealtimeConnectionStatus>('connecting');

	function stopLive() {
		unsubEvents?.();
		unsubConnection?.();
		rt?.destroy();
		rt = null;
		unsubEvents = null;
		unsubConnection = null;
		liveEnabled = false;
		liveEvents = [];
	}

	function startLive() {
		liveEnabled = true;
		rt = createAuditRealtime(data.supabase);
		unsubEvents = rt.events.subscribe((events) => (liveEvents = events));
		unsubConnection = rt.connectionStatus.subscribe((s) => (connectionStatus = s));
	}

	function toggleLive() {
		if (liveEnabled) {
			stopLive();
			return;
		}
		startLive();
	}

	// Submitting the filter form is a real navigation, not a client-side
	// state change this component controls — if live mode is on when that
	// happens, turn it off rather than leaving a stale subscription running
	// against what's now a filtered view.
	$effect(() => {
		if (filtersActive && liveEnabled) {
			stopLive();
		}
	});

	// Live by default — this page is meant to be left open as a running feed,
	// not something an Admin has to remember to switch on. Only client-side
	// (onMount, not module-level state) since it opens a Realtime channel;
	// skipped when the page loads with filters already applied (e.g. a
	// bookmarked/shared filtered URL) — same "unfiltered view only" rule the
	// toggle itself already enforces, checked once against the filters this
	// page loaded with rather than reactively, so it can't fight a later
	// filter change the effect above already handles.
	onMount(() => {
		if (!filtersActive) {
			startLive();
		}
	});

	onDestroy(() => rt?.destroy());

	// New live events are already most-recent-first (auditRealtime.ts
	// prepends); data.events is the SSR snapshot, also most-recent-first.
	// Deduping guards the vanishingly unlikely race where an event both
	// landed in the initial query and arrived as a live INSERT.
	let displayedEvents = $derived.by(() => {
		const liveIds = new Set(liveEvents.map((e) => e.id));
		return [...liveEvents, ...data.events.filter((e) => !liveIds.has(e.id))].slice(0, 100);
	});

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
	<PageHeader title="Audit log" eyebrow="Admin">
		{#snippet actions()}
			<Button
				variant={liveEnabled ? 'brass' : 'outline'}
				size="sm"
				disabled={filtersActive}
				title={filtersActive ? 'Clear filters to go live' : undefined}
				onclick={toggleLive}
			>
				<span
					class={[
						'inline-block size-2 rounded-full',
						liveEnabled ? 'animate-pulse bg-fairway' : 'bg-brass/60'
					]}
				></span>
				{liveEnabled ? 'Live' : 'Go live'}
			</Button>
			<Button variant="outline" size="sm" href={exportHref}>Export CSV</Button>
		{/snippet}
	</PageHeader>

	{#if liveEnabled}
		<RealtimeStatusBanner status={connectionStatus} />
	{/if}

	<form
		method="GET"
		class="flex flex-wrap items-end gap-3 rounded-lg border border-brass/30 bg-scorecard p-4"
	>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Actor</span>
			<Input
				type="text"
				name="participant"
				value={data.filters.participant}
				placeholder="Email"
				disabled={isQuerying}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Player</span>
			<Input
				type="text"
				name="player"
				value={data.filters.player}
				placeholder="Name"
				disabled={isQuerying}
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Tournament</span>
			<select
				name="tournament"
				value={data.filters.tournament}
				disabled={isQuerying}
				class="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-50"
			>
				<option value="">All</option>
				{#each data.tournaments as tournament (tournament.id)}
					<option value={tournament.id}>{tournament.name}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Action</span>
			<select
				name="action"
				value={data.filters.action}
				disabled={isQuerying}
				class="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-50"
			>
				<option value="">All</option>
				{#each AUDIT_ACTIONS as action (action)}
					<option value={action}>{auditActionLabel(action)}</option>
				{/each}
			</select>
		</label>
		<div class="flex flex-col gap-1">
			<div class="flex items-end gap-3">
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-muted-foreground">From</span>
					<Input
						type="datetime-local"
						name="start"
						value={data.filters.start}
						disabled={isQuerying}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-muted-foreground">To</span>
					<Input type="datetime-local" name="end" value={data.filters.end} disabled={isQuerying} />
				</label>
			</div>
			<p class="text-xs text-muted-foreground">
				Times are entered in your browser's local timezone.
			</p>
		</div>
		<input type="hidden" name="tz_offset_minutes" value={tzOffsetMinutes} />
		<Button type="submit" variant="brass" size="sm" disabled={isQuerying}>
			{#if isQuerying}
				<LoaderCircleIcon class="size-3.5 animate-spin" />
			{/if}
			{isQuerying ? 'Applying…' : 'Apply filters'}
		</Button>
		{#if filtersActive}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={isQuerying}
				onclick={() => goto(resolve('/admin/audit'))}
			>
				Clear
			</Button>
		{/if}
	</form>

	{#if displayedEvents.length === 0}
		<EmptyState title="No audit events match these filters" />
	{:else}
		<Table.Root class={isQuerying ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
			<Table.Header>
				<Table.Row>
					<Table.Head class="bg-brass/10">Actor</Table.Head>
					<Table.Head>Time</Table.Head>
					<Table.Head>Action</Table.Head>
					<Table.Head>Entity</Table.Head>
					<Table.Head>Player</Table.Head>
					<Table.Head>Tournament</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each displayedEvents as event (event.id)}
					<Table.Row>
						<Table.Cell class="bg-brass/10 font-medium text-fairway">
							{event.actor_identity ?? '—'}
						</Table.Cell>
						<Table.Cell class="font-data text-xs whitespace-nowrap text-ink/70">
							<a
								href={resolve('/admin/audit/[id]', { id: event.id })}
								class="text-ink hover:underline"
							>
								{formatDateTime(event.created_at)}
							</a>
						</Table.Cell>
						<Table.Cell class="font-data text-xs whitespace-nowrap">{event.action}</Table.Cell>
						<Table.Cell>{event.entity_type}</Table.Cell>
						<Table.Cell>{event.player_name ?? '—'}</Table.Cell>
						<Table.Cell>{event.tournament_name ?? '—'}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
		{#if displayedEvents.length === 100}
			<p class="text-xs text-muted-foreground">
				Showing the 100 most recent matching events — narrow the filters to see older ones.
			</p>
		{/if}
	{/if}
</div>
