<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { navigating, page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import CursorPager from '$lib/components/CursorPager.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MultiSelectFilter from '$lib/components/MultiSelectFilter.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
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

	// MultiSelectFilter is client-state-driven (no real form control of its
	// own), unlike the plain text Input below — mirrored into hidden inputs
	// so it still submits with the rest of the GET form. A writable
	// $derived, not plain $state: it needs to reset to data.filters.roles
	// after any navigation (Next/Prev, Clear, a filter submit elsewhere),
	// not just seed once from the initial load, while still being directly
	// assignable for MultiSelectFilter's own bind:selected.
	let roleFilters = $derived(data.filters.roles);
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
	<PageHeader title="Users" eyebrow="Admin" />

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	<form
		method="GET"
		class="flex flex-wrap items-end gap-3 rounded-lg border border-brass/30 bg-scorecard p-4"
	>
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground">Search</span>
			<Input
				type="search"
				name="search"
				value={data.filters.search}
				placeholder="Name or email…"
				disabled={isQuerying}
				class="max-w-56"
			/>
		</label>
		<div class="flex flex-col gap-1">
			<span class="text-sm text-muted-foreground">Role</span>
			<MultiSelectFilter label="Role" options={roleOptions} bind:selected={roleFilters} />
		</div>
		{#each roleFilters as role (role)}
			<input type="hidden" name="role" value={role} />
		{/each}
		<input type="hidden" name="page_size" value={data.pageSize} />
		<Button type="submit" variant="brass" size="sm" disabled={isQuerying}>
			{isQuerying ? 'Applying…' : 'Apply filters'}
		</Button>
		{#if filtersActive}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={isQuerying}
				onclick={() => goto(routes.adminUsers())}
			>
				Clear
			</Button>
		{/if}
	</form>

	{#snippet usersTable(rows: UserRow[])}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Email</Table.Head>
					<Table.Head>Name</Table.Head>
					<Table.Head>Role</Table.Head>
					<Table.Head>Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as user (user.id)}
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
				{/each}
			</Table.Body>
		</Table.Root>
	{/snippet}

	{#if totalCount === 0}
		<EmptyState title={filtersActive ? 'No users match these filters' : 'No users yet'} />
	{:else}
		<div class="flex flex-col gap-8">
			{#if pendingUsers.length > 0}
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<h2 class="font-display text-lg font-semibold text-ink">Pending approval</h2>
						<Badge variant="sand">{pendingUsers.length}</Badge>
					</div>
					{@render usersTable(pendingUsers)}
				</div>
			{/if}
			{#if otherUsers.length > 0}
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<h2 class="font-display text-lg font-semibold text-ink">All users</h2>
						<Badge variant="sand">{data.othersTotal}</Badge>
					</div>
					{@render usersTable(otherUsers)}
					<CursorPager
						pageSize={data.pageSize}
						{hasNext}
						{hasPrev}
						{nextHref}
						{prevHref}
						disabled={isQuerying}
						onPageSizeChange={changePageSize}
					/>
				</div>
			{/if}
			{#if rejectedUsers.length > 0}
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<h2 class="font-display text-lg font-semibold text-ink">Rejected</h2>
						<Badge variant="outline">{rejectedUsers.length}</Badge>
					</div>
					{@render usersTable(rejectedUsers)}
				</div>
			{/if}
		</div>
	{/if}
</div>
