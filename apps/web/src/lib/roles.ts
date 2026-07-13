import type { BadgeVariant } from '$lib/components/ui/badge';

export type Role = 'unassigned' | 'participant' | 'admin' | 'owner';

export function roleBadgeVariant(role: Role): BadgeVariant {
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
