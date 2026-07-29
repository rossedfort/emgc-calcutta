-- stake_buyback_accepted/rejected notifications (Phase 14 task 3): tells
-- the golfer once the buyer responds to their request — same shape as
-- stake_buyback_requested's own trigger (notify_on_stake_buyback_requested,
-- the previous Phase 14 task's migration): a genuine Postgres trigger, not
-- a call from inside respond-stake-buyback itself.
--
-- Fires only on the pending -> accepted/rejected transition, not on
-- every update to a stake_buybacks row (e.g. respond-stake-buyback's own
-- accept-path recompute doesn't touch this row a second time, but this
-- WHEN clause is the guard against ever double-firing if that ever
-- changed).
create function public.notify_on_stake_buyback_responded()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
  v_player_id uuid;
  v_trigger text;
begin
  select t.kind, e.player_id into v_kind, v_player_id
  from public.player_entries e
  join public.tournaments t on t.id = e.tournament_id
  where e.id = NEW.entry_id;

  if v_kind != 'production' then
    return NEW;
  end if;

  v_trigger := case NEW.status
    when 'accepted' then 'stake_buyback_accepted'
    when 'rejected' then 'stake_buyback_rejected'
  end;

  perform public.call_dispatch_notification(jsonb_build_object(
    'userId', NEW.requester_id,
    'trigger', v_trigger,
    'tournamentId', NEW.tournament_id,
    'playerId', v_player_id,
    'amount', NEW.amount,
    'percentage', NEW.percentage
  ));
  return NEW;
end;
$$;

create trigger stake_buybacks_notify_after_response
after update on public.stake_buybacks
for each row
when (
  OLD.status = 'pending'
  and NEW.status in ('accepted', 'rejected')
)
execute function public.notify_on_stake_buyback_responded();
