import { Constants, type Enums, type Tables } from '@emgc-calcutta/shared-types';
import type { BadgeVariant } from '$lib/components/ui/badge';

// The full generated Row shape, not a hand-picked subset — used for both
// the participant-facing routes under /tournaments and the admin routes
// under /admin/tournaments.
export type Player = Tables<'players'>;

export const PLAYER_STATUSES = Constants.public.Enums.player_status;

// One place for "First Last" display formatting, reused across every
// table/card/header that shows a player's name, instead of duplicating the
// concatenation at each call site.
export function formatPlayerName(player: Pick<Player, 'first_name' | 'last_name'>): string {
	return `${player.first_name} ${player.last_name}`;
}

// status is a player_entries.status (Phase 11 moved it off players), not a
// field on Player itself — parameterized on the bare enum rather than
// Player['status'] so this keeps working for any entry-shaped row.
export function playerStatusBadgeVariant(status: Enums<'player_status'>): BadgeVariant {
	switch (status) {
		case 'reserved':
			return 'flag';
		case 'sold_silent':
		case 'sold_live':
			return 'fairway';
		case 'no_bid':
			return 'sand';
		default:
			return 'outline';
	}
}

export function playerStatusLabel(status: Enums<'player_status'>): string {
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

// A "plus" handicap (a golfer better than scratch) is stored as a negative
// number — displaying it with a literal minus sign reads as a worse-than-
// scratch handicap to anyone used to golf's own "+" convention, so every
// display of a handicap index goes through this rather than the raw number.
// null stays the existing em-dash placeholder for "not recorded."
export function formatHandicapIndex(handicap: number | null): string {
	if (handicap === null) return '—';
	return handicap < 0 ? `+${-handicap}` : `${handicap}`;
}
