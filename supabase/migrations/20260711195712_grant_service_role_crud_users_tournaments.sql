-- Tables created by migrations run as the `postgres` role inherit this
-- project's default privileges for postgres-owned objects in `public`, which
-- only include TRUNCATE/REFERENCES/TRIGGER for service_role/anon/authenticated
-- — not SELECT/INSERT/UPDATE/DELETE (unlike tables created via the Studio SQL
-- editor as `supabase_admin`, which get full CRUD by default). Without this
-- grant, `service_role` gets a Postgres-level "permission denied" before RLS
-- is ever evaluated, even though it's meant to bypass RLS entirely.
grant select, insert, update, delete on public.users to service_role;
grant select, insert, update, delete on public.tournaments to service_role;
