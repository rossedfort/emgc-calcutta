-- Auto-queue on threshold (Phase 4.5, user feedback): a player crossing
-- the reserve threshold during the silent auction is now queued for the
-- live auction automatically, in the same place-bid call that reserves
-- them — no Admin hand-add step. See place-bid/index.ts for the call
-- site.
--
-- Unlike swap_queue_position/open_live_lot/close_live_lot/
-- start_live_auction, this one uses an advisory lock rather than relying
-- on the deferred unique constraint: those functions each touch rows
-- whose identity the caller already knows, but this one has to *compute*
-- the next queue_position by reading the current max, and two players
-- crossing the threshold at the same instant (different players, same
-- tournament) could otherwise both compute the same "next" position from
-- two concurrent transactions before either commits — the deferred
-- constraint only serializes multiple statements *within* one
-- transaction, not across two. Locking on the tournament id serializes
-- exactly the two calls that could actually collide, without blocking
-- unrelated tournaments.
--
-- SECURITY INVOKER (the default), same reasoning as the other queue/lot
-- functions — grants no more authority than the caller already has. This
-- one is called from place-bid using the service-role client (not a
-- user-authenticated one, since place-bid's own auth model is "validate
-- the caller, then act as service-role" throughout), so it needs an
-- explicit grant to service_role — table grants don't imply function
-- grants, and Postgres functions in this project aren't executable by a
-- role unless explicitly granted (see the CLAUDE.md note on service_role
-- needing explicit table grants; the same non-implicit-privilege pattern
-- holds for EXECUTE on functions).
create function public.enqueue_player_for_live_auction(
  p_tournament_id uuid,
  p_player_id uuid
)
returns void
language plpgsql
as $$
declare
  next_position integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_tournament_id::text));

  select coalesce(max(queue_position), 0) + 1 into next_position
  from public.live_lots
  where tournament_id = p_tournament_id;

  insert into public.live_lots (tournament_id, player_id, queue_position)
  values (p_tournament_id, p_player_id, next_position);
end;
$$;

grant execute on function public.enqueue_player_for_live_auction(uuid, uuid) to service_role;
