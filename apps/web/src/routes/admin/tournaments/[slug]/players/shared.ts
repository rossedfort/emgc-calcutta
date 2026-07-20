export interface PlayerFormValues {
	first_name: string;
	last_name: string;
	contact_email: string;
	contact_phone: string;
	flight: string;
	handicap_index: string;
	preferences: string;
}

export interface ParsedPlayer {
	first_name: string;
	last_name: string;
	contact_email: string | null;
	contact_phone: string | null;
	flight: string;
	handicap_index: number | null;
	preferences: string | null;
}

// Shared by the new/create and [playerSlug]/edit/update form actions — same
// fields, same rules either way, mirroring admin/tournaments/shared.ts's
// parseTournamentForm. Client-side validation (see PlayerForm.svelte) is
// just UX; this is the authoritative check before the RLS-permitted
// insert/update is attempted (spec 6.5).
export function parsePlayerForm(formData: FormData): {
	data: ParsedPlayer | null;
	errors: Record<string, string>;
} {
	const errors: Record<string, string> = {};

	const first_name = String(formData.get('first_name') ?? '').trim();
	if (!first_name) errors.first_name = 'First name is required';

	const last_name = String(formData.get('last_name') ?? '').trim();
	if (!last_name) errors.last_name = 'Last name is required';

	const handicapRaw = String(formData.get('handicap_index') ?? '').trim();
	let handicap_index: number | null = null;
	if (handicapRaw) {
		const parsed = Number(handicapRaw);
		if (!Number.isFinite(parsed)) {
			errors.handicap_index = 'Handicap must be a number';
		} else {
			handicap_index = parsed;
		}
	}

	if (Object.keys(errors).length > 0) {
		return { data: null, errors };
	}

	return {
		data: {
			first_name,
			last_name,
			contact_email: String(formData.get('contact_email') ?? '').trim() || null,
			contact_phone: String(formData.get('contact_phone') ?? '').trim() || null,
			flight: String(formData.get('flight') ?? '').trim(),
			handicap_index,
			preferences: String(formData.get('preferences') ?? '').trim() || null
		},
		errors
	};
}
