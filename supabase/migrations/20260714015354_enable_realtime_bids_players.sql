-- Supabase Realtime only broadcasts postgres_changes for tables explicitly
-- added to the supabase_realtime publication — discovered while building
-- the frontend Realtime subscription store, since neither table was in it
-- yet (checked via `select * from pg_publication_tables where pubname =
-- 'supabase_realtime'`), which would have made that store silently receive
-- zero events regardless of how correct its subscription code was.
alter publication supabase_realtime add table public.bids, public.players;
