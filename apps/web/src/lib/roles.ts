import type { BadgeVariant } from '$lib/components/ui/badge';

export type Role = 'unassigned' | 'participant' | 'admin' | 'owner';

export function roleBadgeVariant(role: Role): BadgeVariant {
	switch (role) {
		case 'owner':
			return 'brass';
		case 'admin':
			return 'fairway';
		case 'participant':
			return 'sand';
		default:
			return 'outline';
	}
}
