import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export interface NotificationPrefsForm {
	email_enabled: boolean;
	outbid: boolean;
	bid_on_you: boolean;
	reserved: boolean;
	live_starting: boolean;
	won: boolean;
}

// Mirrors the notification_prefs migration's own column defaults — a
// Participant who's never visited this page yet (no row exists) sees
// every toggle on, matching what dispatch-notification's "no row yet"
// fallback will treat them as once the opt-out-respecting task lands.
const DEFAULT_PREFS: NotificationPrefsForm = {
	email_enabled: true,
	outbid: true,
	bid_on_you: true,
	reserved: true,
	live_starting: true,
	won: true
};

export const load: PageServerLoad = async ({ locals: { session, supabase } }) => {
	if (!session) {
		redirect(303, '/login');
	}

	const { data, error: queryError } = await supabase
		.from('notification_prefs')
		.select('email_enabled, triggers')
		.eq('user_id', session.user.id)
		.maybeSingle();
	if (queryError) {
		error(500, queryError.message);
	}

	const triggers = (data?.triggers as Record<string, boolean> | null) ?? {};
	const prefs: NotificationPrefsForm = {
		email_enabled: data?.email_enabled ?? DEFAULT_PREFS.email_enabled,
		outbid: triggers.outbid ?? DEFAULT_PREFS.outbid,
		bid_on_you: triggers.bid_on_you ?? DEFAULT_PREFS.bid_on_you,
		reserved: triggers.reserved ?? DEFAULT_PREFS.reserved,
		live_starting: triggers.live_starting ?? DEFAULT_PREFS.live_starting,
		won: triggers.won ?? DEFAULT_PREFS.won
	};

	return { prefs };
};

export const actions: Actions = {
	// Upsert rather than update — a Participant's first save is also the
	// first time a notification_prefs row for them exists at all (see the
	// load function's own defaults-when-missing fallback above).
	default: async ({ request, locals: { session, supabase } }) => {
		if (!session) {
			redirect(303, '/login');
		}

		const formData = await request.formData();
		// bits-ui's Switch renders a native-checkbox-style hidden input when
		// given a `name` — present in form data when checked, absent when
		// not, same semantics as a plain HTML checkbox.
		const prefs: NotificationPrefsForm = {
			email_enabled: formData.has('email_enabled'),
			outbid: formData.has('outbid'),
			bid_on_you: formData.has('bid_on_you'),
			reserved: formData.has('reserved'),
			live_starting: formData.has('live_starting'),
			won: formData.has('won')
		};

		const { error: upsertError } = await supabase.from('notification_prefs').upsert(
			{
				user_id: session.user.id,
				email_enabled: prefs.email_enabled,
				triggers: {
					outbid: prefs.outbid,
					bid_on_you: prefs.bid_on_you,
					reserved: prefs.reserved,
					live_starting: prefs.live_starting,
					won: prefs.won
				}
			},
			{ onConflict: 'user_id' }
		);

		if (upsertError) {
			return fail(400, { error: upsertError.message, prefs });
		}

		return { success: true, prefs };
	}
};
