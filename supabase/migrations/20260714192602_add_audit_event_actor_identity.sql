-- actor_identity captures the acting user's email at the moment of the
-- event (from their JWT claims, e.g. ctx.userClaims.email — already an
-- established pattern, see bootstrap-owner/index.ts), not looked up live
-- from users.email. Same "frozen snapshot" reasoning as before/after and
-- actor_id's own on delete set null: an email change or account deletion
-- shouldn't retroactively alter what the audit trail says was true at the
-- time. Nullable for the same reason actor_id is — not every event
-- necessarily has a human actor (e.g. a future system/cron-triggered
-- event).
alter table public.audit_events
  add column actor_identity text;
