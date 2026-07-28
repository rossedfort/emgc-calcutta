// See ../../notify-account-event/index.ts — sends the two account-level
// notifications spec 4.1's first-login flow creates a need for (Phase 12):
// a new-signup alert to every Admin/Owner, and a "you're approved" email to
// a newly-promoted Participant. Deliberately separate from
// dispatch-notification (see dispatch-notification.ts): neither trigger has
// a tournamentId, and neither is something an account holder should be able
// to silently opt out of the way auction notifications (spec 4.7) can be.
export type AccountEventTrigger = "new_signup" | "account_approved";

export interface NotifyAccountEventRequest {
  userId: string;
  trigger: AccountEventTrigger;
  // new_signup only — names who just signed up, so the email to Admins/
  // Owners doesn't read as a generic "someone signed up." subjectName is
  // nullable since a fresh signup's first_name/last_name may not be split
  // out yet (see handle_new_user()'s best-effort split).
  subjectName?: string | null;
  subjectEmail?: string;
}

export interface NotifyAccountEventResponse {
  // False for a failed send — spec 4.7: "failed sends are logged, not
  // retried indefinitely," so a failure here is a normal response, not an
  // HTTP error.
  sent: boolean;
}
