<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MultiSelectFilter from '$lib/components/MultiSelectFilter.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { formatUserName } from '$lib/profile';
	import { ROLES, roleBadgeVariant, roleLabel, type Role } from '$lib/roles';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import type { UserRow } from './types';

	let { data } = $props();
	let { supabase, users, role: viewerRole } = $derived(data);
	let viewerId = $derived(data.session?.user.id);

	let pendingId: string | null = $state(null);
	let errorMessage = $state('');

	let searchQuery = $state('');
	let roleFilters = $state<string[]>([]);
	let roleOptions = $derived(ROLES.map((role) => ({ value: role, label: roleLabel(role) })));

	let filteredUsers = $derived(
		users.filter((user) => {
			if (roleFilters.length > 0 && !roleFilters.includes(user.role)) return false;
			const query = searchQuery.trim().toLowerCase();
			if (
				query &&
				!(formatUserName(user) ?? '').toLowerCase().includes(query) &&
				!user.email.toLowerCase().includes(query)
			) {
				return false;
			}
			return true;
		})
	);

	// Split rather than just sorted to the top, so an Admin working the list
	// sees "someone's waiting" as its own labeled section instead of having
	// to notice an unassigned badge mixed into the rest of the table.
	// Rejected users are unassigned too but split into their own section —
	// they've already been dealt with, so they'd be dead weight cluttering
	// the actionable Pending approval list otherwise.
	let pendingUsers = $derived(
		filteredUsers.filter((user) => user.role === 'unassigned' && !user.rejected_at)
	);
	let rejectedUsers = $derived(
		filteredUsers.filter((user) => user.role === 'unassigned' && !!user.rejected_at)
	);
	let otherUsers = $derived(filteredUsers.filter((user) => user.role !== 'unassigned'));

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

	<div class="flex items-center gap-4 text-sm">
		<Input
			type="search"
			placeholder="Search name or email…"
			bind:value={searchQuery}
			class="max-w-56"
		/>
		<MultiSelectFilter label="Role" options={roleOptions} bind:selected={roleFilters} />
	</div>

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

	{#if filteredUsers.length === 0}
		<EmptyState title="No users match these filters" />
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
						<Badge variant="sand">{otherUsers.length}</Badge>
					</div>
					{@render usersTable(otherUsers)}
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
