import type { BadgeVariant } from '$lib/components/ui/badge';

// No generated Supabase types in this project yet (see spec 6.8) — this is
// just enough of the shape of public.players for both the participant-facing
// routes under /tournaments and the admin routes under /admin/tournaments.
export interface Player {
	id: string;
	slug: string;
	name: string;
	contact_email: string | null;
	contact_phone: string | null;
	preferences: string | null;
	photo_url: string | null;
	flight: string | null;
	status: 'open' | 'reserved' | 'sold_silent' | 'sold_live' | 'no_bid';
	user_id: string | null;
}

export const PLAYER_STATUSES = ['open', 'reserved', 'sold_silent', 'sold_live', 'no_bid'] as const;

export function playerStatusBadgeVariant(status: Player['status']): BadgeVariant {
	switch (status) {
		case 'reserved':
			return 'brass';
		case 'sold_silent':
		case 'sold_live':
			return 'fairway';
		case 'no_bid':
			return 'sand';
		default:
			return 'outline';
	}
}

export function playerStatusLabel(status: Player['status']): string {
	switch (status) {
		case 'sold_silent':
			return 'Sold (silent)';
		case 'sold_live':
			return 'Sold (live)';
		case 'no_bid':
			return 'No bid';
		default:
			return status.charAt(0).toUpperCase() + status.slice(1);
	}
}
