-- Preset queue sorting (Phase 4.5, user feedback): bulk one-click resorts
-- (Handicap ascending/descending, Shuffle — spec 4.3 calls the queue
-- "orderable/shuffleable") on top of the existing manual up/down
-- reordering. The sort comparison itself (by handicap, or a random
-- shuffle) happens client-side in the admin queue page's server actions,
-- against data it already has — this function's only job is to rewrite
-- every given lot's queue_position to match the order it's handed,
-- atomically, the same way swap_queue_position rewrites two at a time.
--
-- Takes the *entire* desired order as one array rather than one pair at a
-- time, so it validates that array is exactly the tournament's current
-- not-yet-opened lots (no more, no fewer) — catches a stale client-side
-- list (e.g. a player auto-queued by a bid landing between page load and
-- the sort action submitting) as an explicit error instead of silently
-- dropping a lot from the queue or leaving stray positions.
create function public.resequence_queue(
  p_tournament_id uuid,
  p_ordered_lot_ids uuid[]
)
returns void
language plpgsql
as $$
declare
  expected_count integer;
  given_count integer;
begin
  select count(*) into expected_count
  from public.live_lots
  where tournament_id = p_tournament_id and opened_at is null;

  given_count := coalesce(array_length(p_ordered_lot_ids, 1), 0);

  if given_count != expected_count then
    raise exception
      'Ordered list has % lots but % are actually queued — try again',
      given_count, expected_count;
  end if;

  if exists (
    select 1
    from unnest(p_ordered_lot_ids) as given(lot_id)
    left join public.live_lots l
      on l.id = given.lot_id
      and l.tournament_id = p_tournament_id
      and l.opened_at is null
    where l.id is null
  ) then
    raise exception 'Ordered list contains a lot that is not queued in this tournament';
  end if;

  update public.live_lots as l
  set queue_position = o.ordinality
  from unnest(p_ordered_lot_ids) with ordinality as o(lot_id, ordinality)
  where l.id = o.lot_id;
end;
$$;

grant execute on function public.resequence_queue(uuid, uuid[]) to authenticated;
