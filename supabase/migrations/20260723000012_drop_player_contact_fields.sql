-- Removes Player.contact_email/contact_phone (Phase 10 backlog item):
-- self-service linking (previous migration) now gives every Player a way
-- to get connected to a User without one, so the CSV import's email-match
-- auto-link — contact_email's only functional use — goes away along with
-- both columns. contact_phone was never read anywhere outside of storage/
-- display, so it's a straightforward drop alongside it.
alter table public.players
  drop column contact_email,
  drop column contact_phone;
