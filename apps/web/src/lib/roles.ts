import { Constants } from '@emgc-calcutta/shared-types';
import type { BadgeVariant } from '$lib/components/ui/badge';

export type Role = 'unassigned' | 'participant' | 'admin' | 'owner';

export const ROLES = Constants.public.Enums.user_role;

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

export function roleLabel(role: Role): string {
	return role.charAt(0).toUpperCase() + role.slice(1);
}
