-- stake_buyback_requested notification (Phase 14 task 2): tells the buyer
-- a golfer wants to buy back part of their stake, mirroring the existing
-- notify_on_bid_insert()/notify_on_player_sold() pattern — a genuine
-- Postgres trigger + pg_net via call_dispatch_notification(), not a call
-- from inside the request-stake-buyback Edge Function itself (see
-- notification_dispatch_triggers.sql's own header comment for why: "the
-- database enforces it, not application code remembering to call it").
--
-- Two triggers sharing one function, not one: a fresh request always
-- inserts with status='pending' (the column default), but re-requesting
-- after an earlier rejection updates that same row (unique(entry_id))
-- back to 'pending' instead of inserting a new one — both paths need to
-- notify the buyer, and an AFTER INSERT trigger alone would miss the
-- second one.
create function public.notify_on_stake_buyback_requested()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
  v_player_id uuid;
begin
  select t.kind, e.player_id into v_kind, v_player_id
  from public.player_entries e
  join public.tournaments t on t.id = e.tournament_id
  where e.id = NEW.entry_id;

  -- Same dry_run skip as every other notification trigger — a rehearsal
  -- tournament shouldn't be able to email anyone.
  if v_kind != 'production' then
    return NEW;
  end if;

  perform public.call_dispatch_notification(jsonb_build_object(
    'userId', NEW.buyer_id,
    'trigger', 'stake_buyback_requested',
    'tournamentId', NEW.tournament_id,
    'playerId', v_player_id,
    'amount', NEW.amount,
    'percentage', NEW.percentage
  ));
  return NEW;
end;
$$;

create trigger stake_buybacks_notify_after_insert
after insert on public.stake_buybacks
for each row execute function public.notify_on_stake_buyback_requested();

create trigger stake_buybacks_notify_after_repending
after update on public.stake_buybacks
for each row
when (NEW.status = 'pending' and OLD.status is distinct from 'pending')
execute function public.notify_on_stake_buyback_requested();
