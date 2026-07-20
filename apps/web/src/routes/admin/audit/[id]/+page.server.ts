import { error } from '@sveltejs/kit';
import type { Json } from '@emgc-calcutta/shared-types';
import type { PageServerLoad } from './$types';

export interface AuditEventDetail {
	id: string;
	action: string;
	entity_type: string;
	entity_id: string | null;
	actor_identity: string | null;
	reason: string | null;
	ip: string | null;
	user_agent: string | null;
	before: Json | null;
	after: Json | null;
	created_at: string;
	tournament_name: string | null;
	player_name: string | null;
}

// Deep-linkable — spec 4.6/6.9 calls this "the page to send someone during
// a dispute", so it shows everything a dispute might turn on: the full
// before/after snapshot, reason, and requester metadata, not just a
// one-line summary like the list view.
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data, error: queryError } = await supabase
		.from('audit_events')
		.select(
			'id, action, entity_type, entity_id, actor_identity, reason, ip, user_agent, before, after, created_at, tournaments(name), players(name)'
		)
		.eq('id', params.id)
		.maybeSingle();
	if (queryError) {
		error(500, queryError.message);
	}
	if (!data) {
		error(404, 'Audit event not found');
	}

	const event: AuditEventDetail = {
		id: data.id,
		action: data.action,
		entity_type: data.entity_type,
		entity_id: data.entity_id,
		actor_identity: data.actor_identity,
		reason: data.reason,
		ip: data.ip,
		user_agent: data.user_agent,
		before: data.before,
		after: data.after,
		created_at: data.created_at,
		tournament_name: (data.tournaments as { name: string } | null)?.name ?? null,
		player_name: (data.players as { name: string } | null)?.name ?? null
	};

	return {
		event,
		title: 'Audit event · EMGC Calcutta',
		description: `Detail for a ${event.action} audit event on ${event.entity_type}.`
	};
};
