<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { navigating, page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import RealtimeStatusBanner from '$lib/components/RealtimeStatusBanner.svelte';
	import { AUDIT_ACTIONS, auditActionLabel, type AuditEventRow } from '$lib/auditActions';
	import CursorPager from '$lib/components/CursorPager.svelte';
	import TableHeaderFilterButton from '$lib/components/TableHeaderFilterButton.svelte';
	import TableHeaderSelectFilter from '$lib/components/TableHeaderSelectFilter.svelte';
	import TableHeaderTextFilter from '$lib/components/TableHeaderTextFilter.svelte';
	import { routes } from '$lib/routes';
	import { createAuditRealtime, type AuditRealtime } from '$lib/stores/auditRealtime';
	import type { RealtimeConnectionStatus } from '$lib/stores/realtime';

	let { data } = $props();

	// The From/To datetime-local inputs in the Time column's own filter
	// popover submit a raw "YYYY-MM-DDTHH:mm" string with no timezone of
	// its own — parseAuditFilters/queryAuditEvents need this browser's own
	// offset to convert it to the correct UTC instant (see
	// $lib/time.ts's localDateTimeToUtcIso). Computed once, not reactively:
	// the browser's own timezone doesn't change mid-session.
	const tzOffsetMinutes = new Date().getTimezoneOffset();

	// Whether we're anywhere but the very first page — used to keep Live
	// mode (which only makes sense against the newest, unfiltered page)
	// off here the same way it's already off while filtered.
	let onFirstPage = $derived(!page.url.searchParams.has('cursor'));

	function pageUrl(params: Record<string, string | null>): string {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(params)) {
			if (value === null) {
				url.searchParams.delete(key);
			} else {
				url.searchParams.set(key, value);
			}
		}
		return `${url.pathname}${url.search}`;
	}

	let nextHref = $derived(
		data.hasNext ? pageUrl({ cursor: data.nextCursor, dir: 'before' }) : null
	);
	let prevHref = $derived(data.hasPrev ? pageUrl({ cursor: data.prevCursor, dir: 'after' }) : null);

	function changePageSize(size: string) {
		goto(pageUrl({ page_size: size, cursor: null, dir: null }));
	}

	// Phase 37: each column's own header filter applies independently
	// (rather than one shared "Apply filters" button submitting every
	// field at once) — every apply is a real navigation, resetting
	// pagination back to page 1 since the result set's boundaries just
	// changed. Supports repeated params (Tournament/Action, now
	// multi-select) alongside plain single-value ones (Actor/Player/Time).
	function applyFilter(updates: Record<string, string | string[] | null>) {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(updates)) {
			url.searchParams.delete(key);
			if (value === null) continue;
			if (Array.isArray(value)) {
				for (const v of value) url.searchParams.append(key, v);
			} else {
				url.searchParams.set(key, value);
			}
		}
		url.searchParams.delete('cursor');
		url.searchParams.delete('dir');
		goto(`${url.pathname}${url.search}`);
	}

	// Carries whatever filters are currently applied — export reflects the
	// current view, not just the 200 rows shown on screen (the export
	// endpoint itself re-runs the same filtered query uncapped).
	let exportHref = $derived(`${routes.adminAuditExport()}${page.url.search}`);

	// Each header filter's own navigation is a real SvelteKit navigation
	// (re-running this route's server `load`), not a fetch this component
	// kicks off itself — `navigating` is the only signal available for it.
	// Scoped to "navigating to this same route" so the indicator doesn't
	// flash while leaving the page entirely.
	let isQuerying = $derived(navigating.to?.route.id === page.route.id);

	let filtersActive = $derived(
		Boolean(
			data.filters.participant ||
			data.filters.player ||
			data.filters.tournaments.length > 0 ||
			data.filters.actions.length > 0 ||
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

	// Applying a header filter is a real navigation, not a client-side
	// state change this component controls — if live mode is on when that
	// happens, turn it off rather than leaving a stale subscription running
	// against what's now a filtered (or no-longer-first-page) view.
	$effect(() => {
		if ((filtersActive || !onFirstPage) && liveEnabled) {
			stopLive();
		}
	});

	// Live by default — this page is meant to be left open as a running feed,
	// not something an Admin has to remember to switch on. Only client-side
	// (onMount, not module-level state) since it opens a Realtime channel;
	// skipped when the page loads with filters already applied (e.g. a
	// bookmarked/shared filtered URL) or anywhere but the first page — same
	// "unfiltered, newest page only" rule the toggle itself already
	// enforces, checked once against how this page loaded rather than
	// reactively, so it can't fight a later change the effect above already
	// handles.
	onMount(() => {
		if (!filtersActive && onFirstPage) {
			startLive();
		}
	});

	onDestroy(() => rt?.destroy());

	// New live events are already most-recent-first (auditRealtime.ts
	// prepends); data.events is the SSR snapshot, also most-recent-first.
	// Deduping guards the vanishingly unlikely race where an event both
	// landed in the initial query and arrived as a live INSERT. Capped to
	// the current page size rather than a fixed 100, so live mode never
	// shows more rows than the paginated view otherwise would.
	let displayedEvents = $derived.by(() => {
		const liveIds = new Set(liveEvents.map((e) => e.id));
		return [...liveEvents, ...data.events.filter((e) => !liveIds.has(e.id))].slice(
			0,
			data.pageSize
		);
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

	// Time is the one column filter that doesn't fit either shared variant
	// (two related datetime-local fields, not a single text value or a
	// checkbox list) — only Audit needs a date range, so it's built inline
	// on TableHeaderFilterButton directly rather than as a third generic
	// $lib/components export.
	let timeOpen = $state(false);
	let startDraft = $state(untrack(() => data.filters.start));
	let endDraft = $state(untrack(() => data.filters.end));
	$effect(() => {
		if (timeOpen) {
			startDraft = data.filters.start;
			endDraft = data.filters.end;
		}
	});

	function applyTime() {
		applyFilter({
			start: startDraft || null,
			end: endDraft || null,
			tz_offset_minutes: startDraft || endDraft ? String(tzOffsetMinutes) : null
		});
		timeOpen = false;
	}

	function clearTime() {
		startDraft = '';
		endDraft = '';
		applyFilter({ start: null, end: null, tz_offset_minutes: null });
		timeOpen = false;
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Audit log" eyebrow="Admin">
		{#snippet actions()}
			<Button
				variant={liveEnabled ? 'brass' : 'outline'}
				size="sm"
				disabled={filtersActive || !onFirstPage}
				title={filtersActive
					? 'Clear filters to go live'
					: !onFirstPage
						? 'Return to the first page to go live'
						: undefined}
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
			{#if filtersActive}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={isQuerying}
					onclick={() => goto(routes.adminAudit())}
				>
					Clear filters
				</Button>
			{/if}
			<Button variant="outline" size="sm" href={exportHref}>Export CSV</Button>
		{/snippet}
	</PageHeader>

	{#if liveEnabled}
		<RealtimeStatusBanner status={connectionStatus} />
	{/if}

	{#if displayedEvents.length === 0}
		<EmptyState title="No audit events match these filters" />
	{:else}
		<Table.Root class={isQuerying ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
			<Table.Header>
				<Table.Row>
					<Table.Head class="bg-brass/10">
						<span class="inline-flex items-center gap-1">
							Actor
							<TableHeaderTextFilter
								label="Actor"
								value={data.filters.participant}
								placeholder="Email"
								onApply={(value) => applyFilter({ participant: value || null })}
							/>
						</span>
					</Table.Head>
					<Table.Head>
						<span class="inline-flex items-center gap-1">
							Time
							<TableHeaderFilterButton
								label="Time"
								active={Boolean(data.filters.start || data.filters.end)}
								bind:open={timeOpen}
							>
								<div class="flex flex-col gap-2">
									<label class="flex flex-col gap-1 text-sm">
										<span class="text-muted-foreground">From</span>
										<Input type="datetime-local" bind:value={startDraft} />
									</label>
									<label class="flex flex-col gap-1 text-sm">
										<span class="text-muted-foreground">To</span>
										<Input type="datetime-local" bind:value={endDraft} />
									</label>
									<p class="text-xs text-muted-foreground">
										Times are entered in your browser's local timezone.
									</p>
									<div class="flex justify-end gap-2">
										{#if data.filters.start || data.filters.end || startDraft || endDraft}
											<Button type="button" variant="outline" size="sm" onclick={clearTime}>
												Clear
											</Button>
										{/if}
										<Button type="button" variant="brass" size="sm" onclick={applyTime}>
											Apply
										</Button>
									</div>
								</div>
							</TableHeaderFilterButton>
						</span>
					</Table.Head>
					<Table.Head>
						<span class="inline-flex items-center gap-1">
							Action
							<TableHeaderSelectFilter
								label="Action"
								options={AUDIT_ACTIONS.map((action) => ({
									value: action,
									label: auditActionLabel(action)
								}))}
								selected={data.filters.actions}
								onApply={(values) => applyFilter({ action: values })}
							/>
						</span>
					</Table.Head>
					<Table.Head>Entity</Table.Head>
					<Table.Head>
						<span class="inline-flex items-center gap-1">
							Player
							<TableHeaderTextFilter
								label="Player"
								value={data.filters.player}
								placeholder="Name"
								onApply={(value) => applyFilter({ player: value || null })}
							/>
						</span>
					</Table.Head>
					<Table.Head>
						<span class="inline-flex items-center gap-1">
							Tournament
							<TableHeaderSelectFilter
								label="Tournament"
								options={data.tournaments.map((tournament) => ({
									value: tournament.id,
									label: tournament.name
								}))}
								selected={data.filters.tournaments}
								onApply={(values) => applyFilter({ tournament: values })}
							/>
						</span>
					</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each displayedEvents as event (event.id)}
					<Table.Row>
						<Table.Cell class="bg-brass/10 font-medium text-fairway">
							{event.actor_identity ?? '—'}
						</Table.Cell>
						<Table.Cell class="font-data text-xs whitespace-nowrap text-ink/70">
							<a href={routes.adminAuditDetail(event.id)} class="text-ink hover:underline">
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
		<CursorPager
			pageSize={data.pageSize}
			hasNext={data.hasNext}
			hasPrev={data.hasPrev}
			{nextHref}
			{prevHref}
			disabled={isQuerying}
			onPageSizeChange={changePageSize}
		/>
	{/if}
</div>
