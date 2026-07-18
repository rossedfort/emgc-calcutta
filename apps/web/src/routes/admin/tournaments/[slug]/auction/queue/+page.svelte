<script lang="ts">
	import { enhance } from '$app/forms';
	import DivisionBadge from '$lib/components/DivisionBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';

	let { data, form } = $props();

	let errorMessage = $derived(form && 'error' in form ? (form.error as string) : null);

	let pending = $state<Record<string, boolean>>({});
	let sortPending = $state(false);
</script>

<div class="flex flex-col gap-6 pt-4">
	{#if errorMessage}
		<p class="text-sm text-destructive">{errorMessage}</p>
	{/if}

	<div class="flex flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<p class="font-data text-xs tracking-widest text-fairway uppercase">Queue</p>
			{#if data.queue.length > 1}
				<div class="flex items-center gap-2">
					<span class="text-xs text-ink/60">Sort:</span>
					<form
						method="POST"
						action="?/sortHandicapAsc"
						use:enhance={() => {
							sortPending = true;
							return async ({ update }) => {
								await update();
								sortPending = false;
							};
						}}
					>
						<Button type="submit" variant="outline" size="sm" disabled={sortPending}>
							Handicap ascending
						</Button>
					</form>
					<form
						method="POST"
						action="?/sortHandicapDesc"
						use:enhance={() => {
							sortPending = true;
							return async ({ update }) => {
								await update();
								sortPending = false;
							};
						}}
					>
						<Button type="submit" variant="outline" size="sm" disabled={sortPending}>
							Handicap descending
						</Button>
					</form>
					<form
						method="POST"
						action="?/sortShuffle"
						use:enhance={() => {
							sortPending = true;
							return async ({ update }) => {
								await update();
								sortPending = false;
							};
						}}
					>
						<Button type="submit" variant="outline" size="sm" disabled={sortPending}>
							Shuffle
						</Button>
					</form>
				</div>
			{/if}
		</div>
		{#if data.queue.length === 0}
			<EmptyState
				title="No players queued yet"
				description="Players are added automatically as they cross the reserve threshold during the silent auction."
			/>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-12">#</Table.Head>
						<Table.Head>Name</Table.Head>
						<Table.Head>Flight</Table.Head>
						<Table.Head>Handicap</Table.Head>
						<Table.Head>Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.queue as lot, index (lot.id)}
						<Table.Row>
							<Table.Cell class="font-data text-ink/60">{index + 1}</Table.Cell>
							<Table.Cell class="font-medium text-ink">
								{lot.player.name}
								<DivisionBadge division={lot.player.division} />
							</Table.Cell>
							<Table.Cell>{lot.player.flight || '—'}</Table.Cell>
							<Table.Cell class="font-data">{lot.player.handicap_index ?? '—'}</Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-1">
									<form
										method="POST"
										action="?/moveUp"
										use:enhance={() => {
											pending[lot.id] = true;
											return async ({ update }) => {
												await update();
												pending[lot.id] = false;
											};
										}}
									>
										<input type="hidden" name="lotId" value={lot.id} />
										<Button
											type="submit"
											variant="outline"
											size="icon-sm"
											disabled={index === 0 || pending[lot.id]}
											aria-label="Move {lot.player.name} up"
										>
											↑
										</Button>
									</form>
									<form
										method="POST"
										action="?/moveDown"
										use:enhance={() => {
											pending[lot.id] = true;
											return async ({ update }) => {
												await update();
												pending[lot.id] = false;
											};
										}}
									>
										<input type="hidden" name="lotId" value={lot.id} />
										<Button
											type="submit"
											variant="outline"
											size="icon-sm"
											disabled={index === data.queue.length - 1 || pending[lot.id]}
											aria-label="Move {lot.player.name} down"
										>
											↓
										</Button>
									</form>
									<form
										method="POST"
										action="?/remove"
										use:enhance={() => {
											pending[lot.id] = true;
											return async ({ update }) => {
												await update();
												pending[lot.id] = false;
											};
										}}
									>
										<input type="hidden" name="lotId" value={lot.id} />
										<Button
											type="submit"
											variant="destructive"
											size="sm"
											disabled={pending[lot.id]}
										>
											Remove
										</Button>
									</form>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
