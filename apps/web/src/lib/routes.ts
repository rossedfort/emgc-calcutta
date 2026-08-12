// Every internal href in this app should go through here rather than calling
// `resolve()` from `$app/paths` directly at each call site. SvelteKit's
// typed router bakes the full route id — including pathless group segments
// like `(app)` — into the string `resolve()` expects, so a route-tree
// reshuffle (moving a directory into/out of a group, as the TV display
// route's `(app)` split did) breaks every call site that spells out that id
// literally. Centralizing them here means a future reshuffle only touches
// this file.
import { resolve } from '$app/paths';

export const routes = {
	home: () => resolve('/(app)'),
	help: () => resolve('/(app)/help'),
	login: () => resolve('/(app)/login'),
	profile: () => resolve('/(app)/profile'),
	settingsNotifications: () => resolve('/(app)/settings/notifications'),

	tournament: (slug: string) => resolve('/(app)/tournaments/[slug]', { slug }),
	tournamentResults: (slug: string) => resolve('/(app)/tournaments/[slug]/results', { slug }),
	tournamentPlayer: (slug: string, playerSlug: string) =>
		resolve('/(app)/tournaments/[slug]/players/[playerSlug]', { slug, playerSlug }),
	myBids: (slug: string) => resolve('/(app)/tournaments/[slug]/me/bids', { slug }),
	myBalance: (slug: string) => resolve('/(app)/tournaments/[slug]/me/balance', { slug }),

	adminUsers: () => resolve('/(app)/admin/users'),
	adminAudit: () => resolve('/(app)/admin/audit'),
	adminAuditDetail: (id: string) => resolve('/(app)/admin/audit/[id]', { id }),
	adminAuditExport: () => resolve('/(app)/admin/audit/export'),

	adminTournaments: () => resolve('/(app)/admin/tournaments'),
	adminTournamentNew: () => resolve('/(app)/admin/tournaments/new'),
	adminTournament: (slug: string) => resolve('/(app)/admin/tournaments/[slug]', { slug }),
	adminTournamentEdit: (slug: string) => resolve('/(app)/admin/tournaments/[slug]/edit', { slug }),
	adminTournamentResults: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/results', { slug }),
	adminTournamentBookkeeping: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/bookkeeping', { slug }),
	adminTournamentPlayers: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/players', { slug }),
	adminTournamentPlayerNew: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/players/new', { slug }),
	adminTournamentPlayerEdit: (slug: string, playerSlug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/players/[playerSlug]/edit', { slug, playerSlug }),
	adminTournamentPlayersImport: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/players/import', { slug }),
	adminTournamentPlayersExport: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/players/export', { slug }),

	adminTournamentAuctionLive: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/auction/live', { slug }),
	adminTournamentAuctionSilent: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/auction/silent', { slug }),
	// New (TV display): breaks out of every ancestor layout via +page@.svelte,
	// so it's not part of the (app) group's rendered shell despite living in
	// the same part of the route tree as the admin live-auction screen.
	adminTournamentAuctionLiveTV: (slug: string) =>
		resolve('/(app)/admin/tournaments/[slug]/auction/live/tv', { slug })
};
