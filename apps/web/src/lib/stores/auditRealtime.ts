import { writable, type Readable } from 'svelte/store';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@emgc-calcutta/shared-types';
import type { AuditEventRow } from '$lib/auditActions';
import { formatPlayerName } from '$lib/players';
import type { RealtimeConnectionStatus } from './realtime';

export interface AuditRealtime {
	events: Readable<AuditEventRow[]>;
	connectionStatus: Readable<RealtimeConnectionStatus>;
	destroy: () => void;
}

// Not tournament-scoped, unlike createTournamentRealtime — audit_events.
// tournament_id is nullable and this view spans every tournament, so
// there's one global channel per Admin/Owner viewer with the live toggle
// on, table-wide (same "no per-row filter, RLS already does the real
// scoping" reasoning bids' own table-wide subscription uses).
export function createAuditRealtime(supabase: SupabaseClient<Database>): AuditRealtime {
	const events = writable<AuditEventRow[]>([]);
	const connectionStatus = writable<RealtimeConnectionStatus>('connecting');

	// Raw postgres_changes payloads only carry player_id/tournament_id, not
	// the joined names the initial SSR query's players(...)/tournaments(...)
	// embeds already provide — each cache avoids a repeat lookup for a
	// player/tournament that shows up across multiple live events in the
	// same session (e.g. several bids landing on the same player).
	const playerNameCache = new Map<string, string | null>();
	const tournamentNameCache = new Map<string, string | null>();

	async function resolvePlayerName(playerId: string | null): Promise<string | null> {
		if (!playerId) return null;
		if (playerNameCache.has(playerId)) return playerNameCache.get(playerId) ?? null;
		const { data } = await supabase
			.from('players')
			.select('first_name, last_name')
			.eq('id', playerId)
			.maybeSingle();
		const name = data ? formatPlayerName(data) : null;
		playerNameCache.set(playerId, name);
		return name;
	}

	async function resolveTournamentName(tournamentId: string | null): Promise<string | null> {
		if (!tournamentId) return null;
		if (tournamentNameCache.has(tournamentId)) return tournamentNameCache.get(tournamentId) ?? null;
		const { data } = await supabase
			.from('tournaments')
			.select('name')
			.eq('id', tournamentId)
			.maybeSingle();
		const name = data?.name ?? null;
		tournamentNameCache.set(tournamentId, name);
		return name;
	}

	const channel = supabase
		.channel('audit-events')
		.on(
			'postgres_changes',
			{ event: 'INSERT', schema: 'public', table: 'audit_events' },
			async (payload) => {
				// A subscriber this table's RLS doesn't cover still gets its
				// callback invoked, but with an empty `new` and an explicit
				// `errors` array rather than real column data (verified
				// directly against the live local stack, not assumed) — should
				// never actually happen here since only Admin/Owner ever reach
				// this toggle at all, but skip defensively rather than
				// rendering a blank row if it somehow ever does.
				if (payload.errors) return;

				const row = payload.new as {
					id: string;
					action: string;
					entity_type: string;
					entity_id: string | null;
					actor_identity: string | null;
					created_at: string;
					player_id: string | null;
					tournament_id: string | null;
				};

				const [player_name, tournament_name] = await Promise.all([
					resolvePlayerName(row.player_id),
					resolveTournamentName(row.tournament_id)
				]);

				events.update((current) => {
					if (current.some((e) => e.id === row.id)) return current;
					return [
						{
							id: row.id,
							action: row.action,
							entity_type: row.entity_type,
							entity_id: row.entity_id,
							actor_identity: row.actor_identity,
							created_at: row.created_at,
							tournament_name,
							player_name
						},
						...current
					];
				});
			}
		)
		.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				connectionStatus.set('connected');
			} else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
				connectionStatus.set('reconnecting');
			}
		});

	return {
		events,
		connectionStatus,
		destroy: () => {
			supabase.removeChannel(channel);
		}
	};
}
