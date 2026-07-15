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
	'lot_opened',
	'lot_sold',
	'csv_import',
	'role_change',
	'settings_change',
	'notification_sent',
	'notification_failed',
	'notification_skipped',
	'bid_marked_paid',
	'placement_set'
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function auditActionLabel(action: string): string {
	return action
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}
