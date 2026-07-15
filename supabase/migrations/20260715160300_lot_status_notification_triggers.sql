-- Database Webhooks on LiveLot/Player changes (spec 4.7/6.7): live-auction-
-- starting (fires once per Participant with a reserved player, when the
-- tournament's live auction opens) and lot-won (fires on both silent-close
-- and live-sold outcomes).
--
-- Both of these are triggered by writes that don't always run as
-- service_role, unlike Bid inserts (which only ever happen through
-- place-bid's service-role client — bids has no client-writable INSERT
-- policy at all): a player transitioning to 'sold_live' can come from
-- close_live_lot(), a SECURITY INVOKER RPC that runs as whichever Admin
-- calls it directly (their own `authenticated` role, not service_role);
-- a tournament's live_auction_started_at being set comes from
-- start_live_auction(), the same SECURITY INVOKER shape. Verified
-- directly (not assumed) that `authenticated` has zero grants on the
-- vault schema — the notify_on_bid_insert trigger's inline vault reads
-- would fail with permission denied for either of these paths, rolling
-- back the Admin's close_live_lot()/start_live_auction() call entirely.
--
-- Fixes this with a single, narrowly-scoped SECURITY DEFINER helper
-- rather than broadening the vault grant to `authenticated` (which would
-- let *any* authenticated user read *every* vault secret project-wide by
-- querying vault.decrypted_secrets directly — a real hole, not a
-- reasonable trade). This function does exactly one thing — read the two
-- named secrets this project's Database Webhooks need, and fire one
-- caller-supplied HTTP POST — nothing that lets a caller read an
-- arbitrary secret or take any other elevated action. `search_path` is
-- pinned per Postgres's own SECURITY DEFINER guidance, even though every
-- reference here is already schema-qualified. This is the first
-- SECURITY DEFINER function in this codebase — every other function so
-- far has deliberately stayed SECURITY INVOKER (see e.g. swap_queue_
-- position's comment) — flagged here explicitly since it's a genuine,
-- deliberate exception, not an oversight.
create function public.call_dispatch_notification(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_function_url text;
  v_service_key text;
begin
  select decrypted_secret into v_function_url
  from vault.decrypted_secrets where name = 'dispatch_notification_url';

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets where name = 'service_role_key';

  perform net.http_post(
    url := v_function_url,
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key
    )
  );
end;
$$;

grant execute on function public.call_dispatch_notification(jsonb) to authenticated, service_role;

-- Retrofit notify_on_bid_insert (previous migration) onto the shared
-- helper too, rather than leaving two copies of the same vault-read +
-- header-building logic — one of which (this one) exists specifically
-- because the inline version doesn't work for every caller. service_role
-- already had the grants the inline version needed directly, so this is
-- a pure simplification for that trigger, not a behavior change.
create or replace function public.notify_on_bid_insert()
returns trigger
language plpgsql
as $$
declare
  v_tournament_id uuid;
  v_threshold numeric;
  v_player_user_id uuid;
  v_previous_high_bidder uuid;
  v_bidder record;
begin
  select p.tournament_id, t.threshold_amount, p.user_id
    into v_tournament_id, v_threshold, v_player_user_id
  from public.players p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = NEW.player_id;

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

-- Live auction starting: fires once per Participant with a reserved
-- player in this tournament, the moment live_auction_started_at is set
-- (start_live_auction() guarantees this happens exactly once per
-- tournament — see its own migration). Not per lot — a Participant with
-- multiple reserved players in the same tournament still gets exactly
-- one "the live auction is starting" email, not one per player.
create function public.notify_on_live_auction_starting()
returns trigger
language plpgsql
as $$
declare
  v_participant record;
begin
  for v_participant in
    select distinct user_id from public.players
    where tournament_id = NEW.id and status = 'reserved' and user_id is not null
  loop
    perform public.call_dispatch_notification(jsonb_build_object(
      'userId', v_participant.user_id,
      'trigger', 'live_starting',
      'tournamentId', NEW.id
    ));
  end loop;
  return NEW;
end;
$$;

create trigger tournaments_notify_live_starting
after update on public.tournaments
for each row
when (NEW.live_auction_started_at is not null and OLD.live_auction_started_at is null)
execute function public.notify_on_live_auction_starting();

-- Lot won: fires the moment a Player's status transitions into a sold
-- state, regardless of which of the two closure paths caused it
-- (close_silent_auctions()'s cron sweep, or close_live_lot()'s Admin
-- action) — the winning bidder is derived the same way both of those
-- functions themselves derive it (current non-voided high bid), rather
-- than needing to know which path fired. no_bid is deliberately excluded
-- — that's not a "won" outcome.
create function public.notify_on_player_sold()
returns trigger
language plpgsql
as $$
declare
  v_winning_bid record;
begin
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

create trigger players_notify_sold
after update on public.players
for each row
when (NEW.status in ('sold_silent', 'sold_live') and OLD.status is distinct from NEW.status)
execute function public.notify_on_player_sold();
