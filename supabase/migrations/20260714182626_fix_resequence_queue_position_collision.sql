-- Fixes a real bug in resequence_queue, caught by the user reproducing it
-- through the admin queue UI's sort presets: the original version
-- renumbered the not-yet-opened lots to a fresh 1..N range, but
-- live_lots_tournament_id_queue_position_key is unique across the *whole*
-- tournament, not just the unopened subset — so once any lot has been
-- opened (consuming low position numbers like 1, 2, ...), resequencing
-- the remaining queue back down to 1..N collides with positions already
-- held by those opened/closed lots. Reproduced directly: a tournament
-- with lot 1 closed and lot 2 currently open, resequencing the 4
-- still-queued lots (previously positions 3-6) down to 1-4 fails with
-- "duplicate key ... (tournament_id, queue_position)=(..., 2) already
-- exists" — position 2 belongs to the open lot.
--
-- Fix: reassign the *existing* set of position values the not-yet-opened
-- lots already occupy (e.g. {3,4,5,6}), permuted into the caller's order,
-- rather than renumbering to 1..N. This never touches a position value
-- outside what the unopened subset already owns, so it can't collide with
-- an opened/closed lot's position no matter how many lots have already
-- been opened.
create or replace function public.resequence_queue(
  p_tournament_id uuid,
  p_ordered_lot_ids uuid[]
)
returns void
language plpgsql
as $$
declare
  existing_positions integer[];
  expected_count integer;
  given_count integer;
begin
  select array_agg(queue_position order by queue_position) into existing_positions
  from public.live_lots
  where tournament_id = p_tournament_id and opened_at is null;

  expected_count := coalesce(array_length(existing_positions, 1), 0);
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
  set queue_position = existing_positions[o.ordinality]
  from unnest(p_ordered_lot_ids) with ordinality as o(lot_id, ordinality)
  where l.id = o.lot_id;
end;
$$;
