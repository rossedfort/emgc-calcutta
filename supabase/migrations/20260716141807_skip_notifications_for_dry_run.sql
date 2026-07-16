-- Bug fix: dry_run tournaments are meant to be an Admin/Owner-only
-- sandbox — participants can't even see one (kind='production' RLS
-- checks in players_select_participant_plus, bids_select_participant_plus,
-- live_lots_select_participant_plus) — but the three notification
-- triggers below still fired real dispatch-notification calls (real
-- emails) for bids/sales/live-start events inside a dry_run tournament.
-- A rehearsal tournament shouldn't be able to email anyone any more than
-- it should be visible to them.

create or replace function public.notify_on_bid_insert()
returns trigger
language plpgsql
as $$
declare
  v_tournament_id uuid;
  v_threshold numeric;
  v_player_user_id uuid;
  v_kind text;
  v_previous_high_bidder uuid;
  v_bidder record;
begin
  select p.tournament_id, t.threshold_amount, p.user_id, t.kind
    into v_tournament_id, v_threshold, v_player_user_id, v_kind
  from public.players p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = NEW.player_id;

  if v_kind != 'production' then
    return NEW;
  end if;

  select bidder_id into v_previous_high_bidder
  from public.bids
  where player_id = NEW.player_id
    and voided_at is null
    and id != NEW.id
  order by amount desc
  limit 1;

  if v_previous_high_bidder is not null and v_previous_high_bidder != NEW.bidder_id then
    perform public.call_dispatch_notification(jsonb_build_object(
      'userId', v_previous_high_bidder,
      'trigger', 'outbid',
      'tournamentId', v_tournament_id,
      'playerId', NEW.player_id,
      'amount', NEW.amount
    ));
  end if;

  if v_player_user_id is not null and v_player_user_id != NEW.bidder_id then
    perform public.call_dispatch_notification(jsonb_build_object(
      'userId', v_player_user_id,
      'trigger', 'bid_on_you',
      'tournamentId', v_tournament_id,
      'playerId', NEW.player_id,
      'amount', NEW.amount
    ));
  end if;

  if NEW.phase = 'silent' and NEW.amount >= v_threshold then
    for v_bidder in
      select distinct bidder_id from public.bids
      where player_id = NEW.player_id and voided_at is null
    loop
      perform public.call_dispatch_notification(jsonb_build_object(
        'userId', v_bidder.bidder_id,
        'trigger', 'reserved',
        'tournamentId', v_tournament_id,
        'playerId', NEW.player_id
      ));
    end loop;
  end if;

  return NEW;
end;
$$;

create or replace function public.notify_on_player_sold()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
  v_winning_bid record;
begin
  select kind into v_kind from public.tournaments where id = NEW.tournament_id;

  if v_kind != 'production' then
    return NEW;
  end if;

  select bidder_id, amount into v_winning_bid
  from public.bids
  where player_id = NEW.id and voided_at is null
  order by amount desc
  limit 1;

  if v_winning_bid.bidder_id is not null then
    perform public.call_dispatch_notification(jsonb_build_object(
      'userId', v_winning_bid.bidder_id,
      'trigger', 'won',
      'tournamentId', NEW.tournament_id,
      'playerId', NEW.id,
      'amount', v_winning_bid.amount
    ));
  end if;
  return NEW;
end;
$$;

-- notify_on_live_auction_starting fires directly off a tournaments row
-- update, so the kind check can live in the trigger's own WHEN clause
-- instead of the function body — no need to touch the function at all.
drop trigger tournaments_notify_live_starting on public.tournaments;

create trigger tournaments_notify_live_starting
after update on public.tournaments
for each row
when (
  NEW.kind = 'production'
  and NEW.live_auction_started_at is not null
  and OLD.live_auction_started_at is null
)
execute function public.notify_on_live_auction_starting();
