// action is deliberately plain text on audit_events, not a DB enum (see
// the create_audit_events migration) — spec 4.6's own action list spans
// multiple future phases, so an ALTER TYPE migration every time a new one
// is added would be pure churn for a descriptive/filterable-only field.
// This is a maintained TS constant instead, driving the Action filter
// dropdown on the admin audit log — update it here when a later phase's
// Edge Functions start logging a new action.
export const AUDIT_ACTIONS = [
	'bid_placed',
	'bid_voided',
	'player_reserved',
	'player_linked',
	'player_unlinked',
	'lot_opened',
	'lot_sold',
	'csv_import',
	'role_change',
	'settings_change',
	'notification_sent',
	'notification_failed',
	'notification_skipped',
	'bid_marked_paid',
	'payout_marked_paid',
	'placement_set'
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function auditActionLabel(action: string): string {
	return action
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

// The shape both the SSR list query (admin/audit/+page.server.ts, joining
// tournaments(name)/players(first_name,last_name) server-side) and the live
// Realtime overlay (auditRealtime.ts, resolving the same two names itself
// per event) ultimately produce — one shared shape so the list page can
// merge and dedupe both sources without a translation step.
export interface AuditEventRow {
	id: string;
	action: string;
	entity_type: string;
	entity_id: string | null;
	actor_identity: string | null;
	created_at: string;
	tournament_name: string | null;
	player_name: string | null;
}
