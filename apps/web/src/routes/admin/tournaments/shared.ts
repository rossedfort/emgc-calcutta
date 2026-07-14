import type { BadgeVariant } from '$lib/components/ui/badge';

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
	anti_snipe_seconds: number;
	payout_structure: Record<string, number>;
	live_auction_started_at: string | null;
	created_at: string;
}

export interface TournamentFormValues {
	name: string;
	kind: 'production' | 'dry_run';
	silent_auction_start: string;
	silent_auction_end: string;
	threshold_amount: string;
	min_increment: string;
	anti_snipe_seconds: string;
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
	anti_snipe_seconds: number;
	payout_structure: Record<string, number>;
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

	const start = String(formData.get('silent_auction_start') ?? '');
	const end = String(formData.get('silent_auction_end') ?? '');
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

	const antiSnipeRaw = String(formData.get('anti_snipe_seconds') ?? '15');
	const anti_snipe_seconds = Number(antiSnipeRaw);
	if (!Number.isInteger(anti_snipe_seconds) || anti_snipe_seconds < 0) {
		errors.anti_snipe_seconds = 'Anti-snipe seconds must be a non-negative whole number';
	}

	let payout_structure: Record<string, number> = {};
	const payoutRaw = String(formData.get('payout_structure') ?? '{}');
	try {
		const parsed = JSON.parse(payoutRaw || '{}');
		for (const [place, percent] of Object.entries(parsed)) {
			if (!/^\d+$/.test(place) || typeof percent !== 'number' || percent <= 0 || percent > 1) {
				throw new Error('invalid payout entry');
			}
		}
		payout_structure = parsed;
	} catch {
		errors.payout_structure = 'Payout structure is invalid — each place must have a percentage';
	}

	if (Object.keys(errors).length > 0) {
		return { data: null, errors };
	}

	return {
		data: {
			name,
			kind,
			silent_auction_start: new Date(start).toISOString(),
			silent_auction_end: new Date(end).toISOString(),
			threshold_amount,
			min_increment,
			anti_snipe_seconds,
			payout_structure
		},
		errors
	};
}
