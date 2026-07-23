-- Database Webhooks on Bid/LiveLot/Player/Tournament changes (spec 4.7/6.7):
-- outbid, bid-on-you, player-reserved, live-auction-starting, and lot-won
-- notifications. Implemented as genuine Postgres triggers + pg_net (not a
-- call from inside place-bid/close_live_lot/etc. themselves) — spec 6.7 is
-- explicit that dispatch-notification is "invoked by a Database Webhook on
-- relevant table changes", matching the same "the database enforces it,
-- not application code remembering to call it" philosophy spec 6.5 already
-- gives for AuditEvent. A trigger also fires for any future path that ever
-- writes these tables, not just today's.
--
-- pg_net.http_post is async — it queues the request and returns
-- immediately, a background worker makes the actual call after this
-- transaction commits. That means a slow or failing notification send can
-- never delay or roll back the write itself (spec 4.7: "don't block the
-- real-time broadcast or UI update"), and a misconfigured secret/URL fails
-- inside pg_net's worker, not inside the caller's request.
create extension if not exists pg_net;

-- Vault secrets store the two environment-specific values these triggers
-- need to call dispatch-notification: the function's own URL (differs
-- between local and the hosted project) and the secret/service-role key
-- dispatch-notification's `auth: "secret"` mode requires. Created here with
-- placeholder values, same reasoning RESEND_API_KEY/OWNER_EMAIL are never
-- committed to git either — the real values are set separately, per
-- environment, after this migration runs (vault.update_secret() locally,
-- the Management API's SQL endpoint or Dashboard SQL Editor for the hosted
-- project).
--
-- Guarded by an existence check rather than a bare vault.create_secret
-- call: the vault schema lives outside public and isn't touched by a
-- schema reset (`supabase db reset --linked` drops/recreates public but
-- leaves an already-configured project's vault secrets in place), so a
-- bare create call fails with a duplicate-name error on any environment
-- that's been through this migration before — confirmed directly while
-- resetting the remote project. This makes the migration safely
-- re-runnable without clobbering a secret some earlier run already set to
-- a real value.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'dispatch_notification_url') then
    perform vault.create_secret(
      'unset',
      'dispatch_notification_url',
      'Full URL of the dispatch-notification Edge Function for this environment'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'service_role_key') then
    perform vault.create_secret(
      'unset',
      'service_role_key',
      'Secret/service-role key used by Database Webhook trigger functions to authenticate to dispatch-notification (auth: secret mode)'
    );
  end if;
end;
$$;

-- Shared helper: reads the two named Vault secrets above and fires one
-- caller-supplied HTTP POST. Needed as a SECURITY DEFINER function (rather
-- than every trigger reading Vault inline) because not every write path
-- that needs to notify runs as service_role — a player transitioning to
-- 'sold_live' can come from close_live_lot(), a SECURITY INVOKER RPC that
-- runs as whichever Admin calls it directly (their own `authenticated`
-- role, not service_role), which has zero grants on the vault schema.
-- SECURITY DEFINER is a deliberate, narrow exception to this codebase's
-- usual "no more authority than the caller already has" pattern: this
-- function does exactly one thing — read these two named secrets and fire
-- one caller-supplied HTTP POST — nothing that lets a caller read an
-- arbitrary secret or take any other elevated action. Broadening the vault
-- grant to `authenticated` instead would let *any* authenticated user read
-- *every* vault secret project-wide by querying vault.decrypted_secrets
-- directly — a real hole, not a reasonable trade. `search_path` is pinned
-- per Postgres's own SECURITY DEFINER guidance, even though every
-- reference here is already schema-qualified.
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
      -- Both the `apikey` header (Kong's own API-key check, gating whether
      -- a request reaches an Edge Function at all) and the `Authorization`
      -- header (dispatch-notification's own `auth: "secret"` check, once
      -- Kong lets the request through) are required, and are two separate
      -- checks.
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key
    )
  );
end;
$$;

grant execute on function public.call_dispatch_notification(jsonb) to authenticated, service_role;

-- Outbid / bid-on-you / player-reserved. Skips dry_run tournaments
-- entirely — a rehearsal tournament shouldn't be able to email anyone any
-- more than it should be visible to them (participants can't even see a
-- dry_run tournament at all, per the players/bids/live_lots select
-- policies).
create function public.notify_on_bid_insert()
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

  -- Outbid: whoever held the highest non-voided bid on this player
  -- immediately before this one. Only fires when that bidder is someone
  -- other than whoever just placed NEW (self-bidding is normal, deliberate
  -- Calcutta behavior — spec 4.9 — so a solo bidder raising their own price
  -- shouldn't "outbid" themselves).
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

  -- Bid on you: the Player's linked User, if any, skipped when it's the
  -- bidder themselves.
  if v_player_user_id is not null and v_player_user_id != NEW.bidder_id then
    perform public.call_dispatch_notification(jsonb_build_object(
      'userId', v_player_user_id,
      'trigger', 'bid_on_you',
      'tournamentId', v_tournament_id,
      'playerId', NEW.player_id,
      'amount', NEW.amount
    ));
  end if;

  -- Player reserved: NEW.phase = 'silent' and NEW.amount >= threshold can
  -- only be true for the one bid that actually crosses it — once crossed,
  -- place-bid flips the player to 'reserved' and every subsequent bid on
  -- them is phase 'live'. Fans out to every distinct non-voided bidder on
  -- this player, including whoever placed the reserving bid themselves —
  -- spec 4.7's trigger is "a player a Participant has bid on crosses the
  -- threshold", which is true for them too.
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

create trigger bids_notify_after_insert
after insert on public.bids
for each row execute function public.notify_on_bid_insert();

-- Live auction starting: fires once per Participant with a reserved player
-- in this tournament, the moment live_auction_started_at is set
-- (start_live_auction() guarantees this happens exactly once per
-- tournament). Not per lot — a Participant with multiple reserved players
-- in the same tournament still gets exactly one "the live auction is
-- starting" email, not one per player. The dry_run skip lives in the
-- trigger's own WHEN clause below rather than this function body, since it
-- fires directly off a tournaments row update.
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
when (
  NEW.kind = 'production'
  and NEW.live_auction_started_at is not null
  and OLD.live_auction_started_at is null
)
execute function public.notify_on_live_auction_starting();

-- Lot won: fires the moment a Player's status transitions into a sold
-- state, regardless of which of the two closure paths caused it
-- (close_silent_auctions()'s cron sweep, or close_live_lot()'s Admin
-- action) — the winning bidder is derived the same way both of those
-- functions themselves derive it (current non-voided high bid), rather
-- than needing to know which path fired. no_bid is deliberately excluded —
-- that's not a "won" outcome.
create function public.notify_on_player_sold()
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

create trigger players_notify_sold
after update on public.players
for each row
when (NEW.status in ('sold_silent', 'sold_live') and OLD.status is distinct from NEW.status)
execute function public.notify_on_player_sold();
