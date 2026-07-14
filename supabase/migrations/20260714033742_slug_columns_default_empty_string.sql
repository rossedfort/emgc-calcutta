-- players.slug/tournaments.slug are NOT NULL with no column default —
-- correct at the schema level, since a BEFORE INSERT trigger
-- (players_set_slug/tournaments_set_slug) always fills in a real value.
-- But that trigger only computes a slug when the incoming value is null
-- or '' (an editable-at-creation override is allowed to pass an explicit
-- slug instead), so omitting slug on insert has always been valid at
-- runtime — the schema just couldn't express that.
--
-- This became a real problem once apps/web started consuming the
-- generated Database type (packages/shared-types/src/database.ts):
-- `supabase gen types typescript` only looks at column defaults, not
-- trigger behavior, to decide whether an Insert field is optional — so
-- it marked slug required, and every existing insert call that (correctly)
-- omits slug failed to typecheck. Giving the column a default of '' is a
-- no-op at the database level (the trigger already treats '' as "please
-- generate one," identically to null), but makes the generated type
-- accurately reflect real behavior.
alter table public.players alter column slug set default '';
alter table public.tournaments alter column slug set default '';
