-- Phase 1.6: multi-tournament support. `kind` distinguishes real
-- tournaments from Admin-run rehearsals so dry runs are visually
-- distinguishable in the admin list and can be excluded from historical
-- views later without deleting their data. See spec sections 2 and 5.
alter table public.tournaments
  add column kind text not null default 'production' check (kind in ('production', 'dry_run'));
