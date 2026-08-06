-- Phase 17: hard-delete a dry-run tournament and everything under it.
--
-- Not reachable by any client role directly: bids/live_lots/payouts/
-- stake_buybacks all reference player_entries with no ON DELETE cascade
-- (deliberately, to protect financial/audit history — see each table's own
-- create migration), so tournaments cascading straight to players/
-- player_entries alone would hit a hard FK violation on any tournament with
-- real activity. This function does the cascade explicitly, in dependency
-- order, and only for kind = 'dry_run' — a dry run is a disposable
-- rehearsal (spec 6.4), not real audit history, so it's safe to actually
-- remove rather than soft-delete. A production tournament stays
-- permanently un-deletable, unchanged from today.
--
-- Execute is granted to service_role only, not authenticated — unlike
-- swap_queue_position/close_live_lot (which only ever touch rows Admin/
-- Owner already has RLS UPDATE access to), this needs to bypass RLS on
-- tables like bids that are documented as having no write policy "or ever
-- will be." Keeping this service_role-only means the only path in is the
-- delete-tournament Edge Function, which does the Owner/Admin auth check
-- and audit logging itself — same posture already established for
-- AuditEvent writes generally.
--
-- No explicit audit_events handling: every FK from it (tournament_id/
-- player_id/entry_id) is already `on delete set null`, so any dry-run
-- audit history (e.g. test bids placed during rehearsal) survives,
-- orphaned but intact, matching that table's existing "immutable, never
-- client-deletable" posture.
create function public.delete_tournament_cascade(p_tournament_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target_kind text;
begin
  select kind into target_kind
  from public.tournaments
  where id = p_tournament_id;

  if target_kind is null then
    raise exception 'Tournament not found';
  end if;

  if target_kind <> 'dry_run' then
    raise exception 'Only dry-run tournaments can be deleted';
  end if;

  delete from public.bids
  where entry_id in (
    select id from public.player_entries where tournament_id = p_tournament_id
  );

  delete from public.live_lots where tournament_id = p_tournament_id;
  delete from public.payouts where tournament_id = p_tournament_id;
  delete from public.stake_buybacks where tournament_id = p_tournament_id;
  delete from public.player_entries where tournament_id = p_tournament_id;
  delete from public.players where tournament_id = p_tournament_id;
  delete from public.tournaments where id = p_tournament_id;
end;
$$;

revoke all on function public.delete_tournament_cascade(uuid) from public;
grant execute on function public.delete_tournament_cascade(uuid) to service_role;
