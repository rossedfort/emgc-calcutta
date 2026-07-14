-- Admin-only writes for building/reordering the live auction queue
-- (spec's `/admin/auction/queue`, now nested under tournamentSlug — see
-- the note after the Silent/Live auction routes table). This is simple
-- state (which players are queued, in what order), not validation-heavy
-- like place-bid, so it's plain RLS-permitted writes rather than an Edge
-- Function — same reasoning the "Lot open/close" backlog task already
-- calls for, and this same policy covers that task's writes too (open/
-- close is just updating other columns on rows this policy already lets
-- Admin/Owner touch), so it isn't added again there.
--
-- Scoped to admin/owner only, with no additional tournament-kind check
-- (unlike the select policy) — Admin/Owner already see and can act on
-- every tournament regardless of kind, so there's nothing further to
-- restrict here.
create policy "live_lots_write_admin_owner" on public.live_lots
for all to authenticated
using (public.current_user_role() in ('admin', 'owner'))
with check (public.current_user_role() in ('admin', 'owner'));

-- Reordering the queue means swapping two rows' queue_position — under a
-- plain (immediate) unique constraint, a two-statement swap fails
-- because the first UPDATE alone collides with whichever row still
-- holds the target value (verified directly: a single UPDATE...CASE
-- covering both rows fails too, since Postgres checks a unique
-- constraint as each row is written within a statement, not once at
-- statement end). Deferring the check to end-of-transaction is what
-- makes the two-statement swap inside swap_queue_position below actually
-- work — but the original migration created this as a plain unique
-- index, not a table constraint, and ALTER CONSTRAINT only applies to
-- the latter, so it has to be dropped and recreated as one.
drop index public.live_lots_tournament_id_queue_position_key;

alter table public.live_lots
  add constraint live_lots_tournament_id_queue_position_key
  unique (tournament_id, queue_position) deferrable initially deferred;

-- Swaps two lots' queue_position atomically. Plain SECURITY INVOKER
-- (the default) — deliberately not SECURITY DEFINER, since the write
-- policy above already lets Admin/Owner update these rows directly; this
-- function grants no more authority than the caller already has, it
-- just makes the swap possible in one transaction from a single RPC call
-- (a plain PostgREST client can't wrap two separate .update() calls in
-- one transaction on its own).
create function public.swap_queue_position(lot_a uuid, lot_b uuid)
returns void
language plpgsql
as $$
declare
  pos_a integer;
  pos_b integer;
begin
  select queue_position into pos_a from public.live_lots where id = lot_a;
  select queue_position into pos_b from public.live_lots where id = lot_b;

  if pos_a is null or pos_b is null then
    raise exception 'Both lots must exist';
  end if;

  update public.live_lots set queue_position = pos_b where id = lot_a;
  update public.live_lots set queue_position = pos_a where id = lot_b;
end;
$$;

grant execute on function public.swap_queue_position(uuid, uuid) to authenticated;
