<script lang="ts">
	import { FunctionsHttpError } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import type { Role, UserRow } from './types';

	let { data } = $props();
	let { supabase, users, role: viewerRole } = $derived(data);
	let viewerId = $derived(data.session?.user.id);

	let pendingId: string | null = $state(null);
	let errorMessage = $state('');

	function roleBadgeVariant(role: Role): BadgeVariant {
		switch (role) {
			case 'owner':
				return 'default';
			case 'admin':
				return 'secondary';
			case 'participant':
				return 'outline';
			default:
				return 'outline';
		}
	}

	// Mirrors the authorization rules enforced server-side in the
	// update-user-role Edge Function — this only controls which buttons are
	// shown, the function is the actual source of truth.
	function actionsFor(row: UserRow): { label: string; role: Role }[] {
		if (row.id === viewerId || row.role === 'owner') {
			return [];
		}
		if (row.role === 'unassigned') {
			return [{ label: 'Make participant', role: 'participant' }];
		}
		if (row.role === 'participant') {
			const actions: { label: string; role: Role }[] = [
				{ label: 'Remove participant', role: 'unassigned' }
			];
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

	async function setRole(userId: string, role: Role) {
		pendingId = userId;
		errorMessage = '';

		const { error } = await supabase.functions.invoke('update-user-role', {
			body: { userId, role }
		});

		if (error) {
			errorMessage = 'Failed to update role';
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
	<h2 class="text-lg font-medium text-foreground">Users</h2>

	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

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
			{#each users as user (user.id)}
				<Table.Row>
					<Table.Cell>{user.email}</Table.Cell>
					<Table.Cell>{user.name ?? '—'}</Table.Cell>
					<Table.Cell>
						<Badge variant={roleBadgeVariant(user.role)}>{user.role}</Badge>
						{#if user.id === viewerId}
							<span class="text-xs text-muted-foreground">(you)</span>
						{/if}
					</Table.Cell>
					<Table.Cell>
						<div class="flex gap-2">
							{#each actionsFor(user) as action (action.label)}
								<Button
									variant="outline"
									size="sm"
									disabled={pendingId === user.id}
									onclick={() => setRole(user.id, action.role)}
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
</div>
