<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { navigating, page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import CursorPager from '$lib/components/CursorPager.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import TableHeaderSelectFilter from '$lib/components/TableHeaderSelectFilter.svelte';
	import TableHeaderTextFilter from '$lib/components/TableHeaderTextFilter.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { formatUserName } from '$lib/profile';
	import { ROLES, roleBadgeVariant, roleLabel, type Role } from '$lib/roles';
	import { routes } from '$lib/routes';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import type { UserRow } from './types';

	let { data } = $props();
	let { supabase, role: viewerRole } = $derived(data);
	let viewerId = $derived(data.session?.user.id);

	let pendingId: string | null = $state(null);
	let errorMessage = $state('');

	let roleOptions = $derived(ROLES.map((role) => ({ value: role, label: roleLabel(role) })));

	let isQuerying = $derived(navigating.to?.route.id === page.route.id);
	let filtersActive = $derived(Boolean(data.filters.search || data.filters.roles.length > 0));

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

	// Phase 37: each column's own header filter applies independently
	// (rather than one shared "Apply filters" button submitting every field
	// at once) — every apply is a real navigation, resetting pagination back
	// to page 1 since the "everyone else" section's result set boundaries
	// just changed. Supports repeated params (Role, multi-select) alongside
	// the plain single-value Search filter, mirroring Audit's applyFilter.
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
		url.searchParams.delete('page');
		goto(`${url.pathname}${url.search}`);
	}

	let hasNext = $derived(data.page * data.pageSize < data.othersTotal);
	let hasPrev = $derived(data.page > 1);
	let nextHref = $derived(hasNext ? pageUrl({ page: String(data.page + 1) }) : null);
	let prevHref = $derived(hasPrev ? pageUrl({ page: String(data.page - 1) }) : null);

	function changePageSize(size: string) {
		goto(pageUrl({ page_size: size, page: null }));
	}

	// Split rather than just sorted to the top, so an Admin working the list
	// sees "someone's waiting" as its own labeled section instead of having
	// to notice an unassigned badge mixed into the rest of the table.
	// Rejected users are unassigned too but split into their own section —
	// they've already been dealt with, so they'd be dead weight cluttering
	// the actionable Pending approval list otherwise. Both sections are now
	// server-filtered/unpaginated (see +page.server.ts); only "everyone
	// else" (`data.others`) is paginated.
	let pendingUsers = $derived(data.pending);
	let rejectedUsers = $derived(data.rejected);
	let otherUsers = $derived(data.others);

	let totalCount = $derived(pendingUsers.length + rejectedUsers.length + data.othersTotal);

	type UserAction =
		{ label: string; role: Role } | { label: string; action: 'reject' | 'unreject' };

	// Mirrors the authorization rules enforced server-side in the
	// update-user-role Edge Function — this only controls which buttons are
	// shown, the function is the actual source of truth.
	function actionsFor(row: UserRow): UserAction[] {
		if (row.id === viewerId || row.role === 'owner') {
			return [];
		}
		if (row.role === 'unassigned') {
			if (row.rejected_at) {
				return [{ label: 'Un-reject', action: 'unreject' }];
			}
			return [
				{ label: 'Make participant', role: 'participant' },
				{ label: 'Reject', action: 'reject' }
			];
		}
		if (row.role === 'participant') {
			const actions: UserAction[] = [{ label: 'Remove participant', role: 'unassigned' }];
			if (viewerRole === 'owner') {
				actions.push({ label: 'Make admin', role: 'admin' });
			}
			return actions;
		}
		if (row.role === 'admin' && viewerRole === 'owner') {
			return [{ label: 'Remove admin', role: 'participant' }];
		}
		return [];
	}

	async function runAction(userId: string, action: UserAction) {
		pendingId = userId;
		errorMessage = '';

		const body =
			'role' in action ? { userId, role: action.role } : { userId, action: action.action };
		const { error } = await supabase.functions.invoke('update-user-role', { body });

		if (error) {
			errorMessage = 'Failed to update user';
			if (error instanceof FunctionsHttpError) {
				const body = await error.context.json().catch(() => null);
				if (body?.error) errorMessage = body.error;
			}
		} else {
			await invalidateAll();
		}

		pendingId = null;
	}
</script>

<div class="flex flex-col gap-4">
	<PageHeader title="Users" eyebrow="Admin">
		{#snippet actions()}
			{#if filtersActive}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={isQuerying}
					onclick={() => goto(routes.adminUsers())}
				>
					Clear filters
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	{#snippet userRow(user: UserRow)}
		<Table.Row>
			<Table.Cell>{user.email}</Table.Cell>
			<Table.Cell>{formatUserName(user) ?? '—'}</Table.Cell>
			<Table.Cell class="whitespace-nowrap">
				{#if user.role === 'unassigned' && user.rejected_at}
					<Badge variant="destructive">Rejected</Badge>
				{:else}
					<Badge variant={roleBadgeVariant(user.role)}>{user.role}</Badge>
				{/if}
				{#if user.id === viewerId}
					<span class="text-xs text-muted-foreground">(you)</span>
				{/if}
			</Table.Cell>
			<Table.Cell>
				<div class="flex gap-2">
					{#each actionsFor(user) as action (action.label)}
						<Button
							variant="brass"
							size="sm"
							disabled={pendingId === user.id}
							onclick={() => runAction(user.id, action)}
						>
							{action.label}
						</Button>
					{/each}
				</div>
			</Table.Cell>
		</Table.Row>
	{/snippet}

	{#if totalCount === 0}
		<EmptyState title={filtersActive ? 'No users match these filters' : 'No users yet'} />
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>
						<span class="inline-flex items-center gap-1">
							Email
							<TableHeaderTextFilter
								label="Search"
								value={data.filters.search}
								placeholder="Name or email…"
								onApply={(value) => applyFilter({ search: value || null })}
							/>
						</span>
					</Table.Head>
					<Table.Head>Name</Table.Head>
					<Table.Head>
						<span class="inline-flex items-center gap-1">
							Role
							<TableHeaderSelectFilter
								label="Role"
								options={roleOptions}
								selected={data.filters.roles}
								onApply={(values) => applyFilter({ role: values })}
							/>
						</span>
					</Table.Head>
					<Table.Head>Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if pendingUsers.length > 0}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell colspan={4} class="text-sm text-fairway">
							Pending approval
							<span class="text-ink/50 text-xs font-data">· {pendingUsers.length}</span>
						</Table.Cell>
					</Table.Row>
					{#each pendingUsers as user (user.id)}
						{@render userRow(user)}
					{/each}
				{/if}
				{#if otherUsers.length > 0}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell colspan={4} class="text-sm text-fairway">
							All users
							<span class="text-ink/50 text-xs font-data">· {data.othersTotal}</span>
						</Table.Cell>
					</Table.Row>
					{#each otherUsers as user (user.id)}
						{@render userRow(user)}
					{/each}
				{/if}
				{#if rejectedUsers.length > 0}
					<Table.Row class="bg-sand/20 hover:bg-sand/20">
						<Table.Cell colspan={4} class="text-sm text-fairway">
							Rejected
							<span class="text-ink/50 text-xs font-data">· {rejectedUsers.length}</span>
						</Table.Cell>
					</Table.Row>
					{#each rejectedUsers as user (user.id)}
						{@render userRow(user)}
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
		{#if otherUsers.length > 0}
			<CursorPager
				pageSize={data.pageSize}
				{hasNext}
				{hasPrev}
				{nextHref}
				{prevHref}
				disabled={isQuerying}
				onPageSizeChange={changePageSize}
			/>
		{/if}
	{/if}
</div>
