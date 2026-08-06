import type { BadgeVariant } from '$lib/components/ui/badge';
import { localDateTimeToUtcIso } from '$lib/time';

// No generated Supabase types in this project yet (see spec 6.8) — this is
// just enough of the shape of public.tournaments for this feature.
export interface Tournament {
	id: string;
	slug: string;
	name: string;
	silent_auction_start: string;
	silent_auction_end: string;
	status: 'setup' | 'active' | 'complete';
	kind: 'production' | 'dry_run';
	threshold_amount: number;
	min_increment: number;
	// Phase 21: floor on an entry's very first bid only — min_increment
	// alone governs every bid after that, unchanged.
	minimum_bid: number;
	anti_snipe_seconds: number;
	payout_structure: Record<string, number>;
	flights: string[];
	championship_flight: string | null;
	live_auction_started_at: string | null;
	// Phase 14 (stake buy-back): both nullable/unset by default — a
	// tournament that's never configured either has the feature off
	// entirely, same "unconfigured means off" precedent as
	// payout_structure defaulting to {}.
	buy_back_percentage: number | null;
	event_start_at: string | null;
	created_at: string;
}

export interface TournamentFormValues {
	name: string;
	kind: 'production' | 'dry_run';
	silent_auction_start: string;
	silent_auction_end: string;
	threshold_amount: string;
	min_increment: string;
	minimum_bid: string;
	anti_snipe_seconds: string;
	championship_flight: string;
	// '' means unset for both, same as championship_flight above.
	buy_back_percentage: string;
	event_start_at: string;
}

export interface PayoutRow {
	place: string;
	percent: string;
}

export function statusBadgeVariant(status: Tournament['status']): BadgeVariant {
	switch (status) {
		case 'active':
			return 'fairway';
		case 'complete':
			return 'outline';
		default:
			return 'sand';
	}
}

export interface ParsedTournament {
	name: string;
	kind: 'production' | 'dry_run';
	silent_auction_start: string;
	silent_auction_end: string;
	threshold_amount: number;
	min_increment: number;
	minimum_bid: number;
	anti_snipe_seconds: number;
	payout_structure: Record<string, number>;
	flights: string[];
	championship_flight: string | null;
	buy_back_percentage: number | null;
	event_start_at: string | null;
}

// Shared by the new/create and [slug]/edit/update form actions — same fields,
// same rules either way. Client-side validation (see TournamentForm.svelte)
// is just UX; this is the authoritative check before the RLS-permitted
// insert/update is attempted (spec 6.5: basic form validation doesn't need
// an Edge Function the way "validate against current state under concurrent
// writes" writes like bid placement do).
export function parseTournamentForm(formData: FormData): {
	data: ParsedTournament | null;
	errors: Record<string, string>;
} {
	const errors: Record<string, string> = {};

	const name = String(formData.get('name') ?? '').trim();
	if (!name) errors.name = 'Name is required';

	const kindRaw = String(formData.get('kind') ?? 'production');
	const kind: 'production' | 'dry_run' = kindRaw === 'dry_run' ? 'dry_run' : 'production';

	// The raw <input type="datetime-local"> value has no timezone of its
	// own — only the browser that rendered it knows what offset applies, so
	// the browser submits its own `Date.prototype.getTimezoneOffset()`
	// alongside the raw value (TournamentForm.svelte) rather than this
	// server ever guessing. Falls back to 0 (UTC) if missing/malformed
	// (e.g. JS disabled) — same "hidden field required for correctness, no
	// graceful no-JS path" trade-off already made for payout_structure/
	// flights below.
	const tzOffsetRaw = Number(formData.get('tz_offset_minutes'));
	const tzOffsetMinutes = Number.isFinite(tzOffsetRaw) ? tzOffsetRaw : 0;

	const startRaw = String(formData.get('silent_auction_start') ?? '');
	const endRaw = String(formData.get('silent_auction_end') ?? '');
	const start = startRaw ? localDateTimeToUtcIso(startRaw, tzOffsetMinutes) : null;
	const end = endRaw ? localDateTimeToUtcIso(endRaw, tzOffsetMinutes) : null;
	if (!start) errors.silent_auction_start = 'Start is required';
	if (!end) errors.silent_auction_end = 'End is required';
	if (start && end && new Date(end) <= new Date(start)) {
		errors.silent_auction_end = 'End must be after start';
	}

	const thresholdRaw = String(formData.get('threshold_amount') ?? '');
	const threshold_amount = Number(thresholdRaw);
	if (!thresholdRaw || !Number.isFinite(threshold_amount) || threshold_amount <= 0) {
		errors.threshold_amount = 'Threshold must be a positive number';
	}

	const minIncrementRaw = String(formData.get('min_increment') ?? '');
	const min_increment = Number(minIncrementRaw);
	if (!minIncrementRaw || !Number.isFinite(min_increment) || min_increment <= 0) {
		errors.min_increment = 'Minimum increment must be a positive number';
	}

	// Phase 21: floor on an entry's very first bid only (place-bid's own
	// min_increment check is skipped entirely when no bid exists yet) —
	// same positive-number validation as threshold_amount/min_increment.
	const minimumBidRaw = String(formData.get('minimum_bid') ?? '');
	const minimum_bid = Number(minimumBidRaw);
	if (!minimumBidRaw || !Number.isFinite(minimum_bid) || minimum_bid <= 0) {
		errors.minimum_bid = 'Minimum opening bid must be a positive number';
	}

	const antiSnipeRaw = String(formData.get('anti_snipe_seconds') ?? '15');
	const anti_snipe_seconds = Number(antiSnipeRaw);
	if (!Number.isInteger(anti_snipe_seconds) || anti_snipe_seconds < 0) {
		errors.anti_snipe_seconds = 'Anti-snipe seconds must be a non-negative whole number';
	}

	let payout_structure: Record<string, number> = {};
	const payoutRaw = String(formData.get('payout_structure') ?? '{}');
	try {
		const parsed = JSON.parse(payoutRaw || '{}');
		let total = 0;
		for (const [place, percent] of Object.entries(parsed)) {
			if (!/^\d+$/.test(place) || typeof percent !== 'number' || percent <= 0 || percent > 1) {
				throw new Error('invalid payout entry');
			}
			total += percent;
		}
		// Each entry is already bounded to (0, 1] above; nothing previously
		// checked the total across all places, so e.g. 1st=60%/2nd=60% (a
		// nonsensical 120% payout) passed silently. Epsilon tolerance: percents
		// are entered as whole numbers and divided by 100 client-side, so a
		// legitimate 100% split (e.g. seven 7% places + one 9%) can float-drift
		// to 1.0000000000000004 and would otherwise be rejected incorrectly.
		if (total > 1 + 1e-9) {
			errors.payout_structure =
				'Payout percentages add up to more than 100% — reduce one or more places';
		} else {
			payout_structure = parsed;
		}
	} catch {
		errors.payout_structure = 'Payout structure is invalid — each place must have a percentage';
	}

	// Flights (Phase 7.5): an ordered list of unique, non-empty names — order
	// matters (it's the display/ranking order per flight elsewhere), so this
	// is a JSON array, not a Set. Client-side duplicate/empty filtering
	// happens too (TournamentForm.svelte), but this is the authoritative
	// check, same reasoning as payout_structure above.
	let flights: string[] = [];
	const flightsRaw = String(formData.get('flights') ?? '[]');
	try {
		const parsed = JSON.parse(flightsRaw || '[]');
		if (!Array.isArray(parsed) || !parsed.every((f) => typeof f === 'string' && f.trim())) {
			throw new Error('invalid flights entry');
		}
		const trimmed = parsed.map((f: string) => f.trim());
		if (new Set(trimmed).size !== trimmed.length) {
			throw new Error('duplicate flight name');
		}
		flights = trimmed;
	} catch {
		errors.flights = 'Flights must be a list of unique, non-empty names';
	}

	// '' means "no Championship flight" (tournaments.championship_flight is
	// nullable) — validated against `flights` here too, ahead of the DB's
	// own check constraint, so a bad combination surfaces as a clear form
	// error rather than a raw constraint violation.
	const championshipFlightRaw = String(formData.get('championship_flight') ?? '').trim();
	const championship_flight = championshipFlightRaw || null;
	if (championship_flight && !flights.includes(championship_flight)) {
		errors.championship_flight = 'Championship flight must be one of the flights listed above';
	}

	// Buy-back (Phase 14): both fields optional and independent — a
	// tournament can set the percentage without a start-date cutoff (buy-
	// back stays available indefinitely, matching request-stake-buyback's
	// own "null event_start_at means no gate" behavior), or vice versa.
	// Entered as a whole-number percentage (matching payout_structure's own
	// convention above), converted to the 0-1 fraction the DB check
	// constraint expects.
	let buy_back_percentage: number | null = null;
	const buyBackPercentageRaw = String(formData.get('buy_back_percentage') ?? '').trim();
	if (buyBackPercentageRaw) {
		const parsed = Number(buyBackPercentageRaw);
		if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) {
			errors.buy_back_percentage = 'Buy-back percentage must be between 1 and 99';
		} else {
			buy_back_percentage = parsed / 100;
		}
	}

	const eventStartRaw = String(formData.get('event_start_at') ?? '');
	const event_start_at = eventStartRaw
		? localDateTimeToUtcIso(eventStartRaw, tzOffsetMinutes)
		: null;
	if (eventStartRaw && !event_start_at) {
		errors.event_start_at = 'Tournament start is invalid';
	}

	if (Object.keys(errors).length > 0) {
		return { data: null, errors };
	}

	return {
		data: {
			name,
			kind,
			silent_auction_start: start!,
			silent_auction_end: end!,
			threshold_amount,
			min_increment,
			minimum_bid,
			anti_snipe_seconds,
			payout_structure,
			flights,
			championship_flight,
			buy_back_percentage,
			event_start_at
		},
		errors
	};
}
