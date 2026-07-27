-- notification_prefs.email_enabled defaulted to true (opt-out) even though
-- spec 4.7 calls this "opt-in ... not forced" -- flipping the column
-- default to false so a user who's never visited /settings/notifications
-- gets a genuinely disabled-by-default state, not enabled-unless-they-
-- opt-out. Only affects rows inserted after this migration (the explicit
-- default a bare INSERT without the column falls back to) -- anyone who
-- already saved an explicit preference (a real row already exists) keeps
-- whatever they chose, untouched.
alter table public.notification_prefs alter column email_enabled set default false;
