-- Database Webhook on Bid insert (spec 4.7/6.7): outbid, bid-on-you, and
-- player-reserved notifications. Implemented as a genuine Postgres
-- trigger + pg_net (not a call from inside place-bid itself) — spec 6.7
-- is explicit that dispatch-notification is "invoked by a Database
-- Webhook on relevant table changes", matching the same "the database
-- enforces it, not application code remembering to call it" philosophy
-- spec 6.5 already gives for AuditEvent. A trigger also fires for any
-- future path that ever inserts a Bid, not just today's one.
--
-- pg_net.http_post is async — it queues the request and returns
-- immediately, a background worker makes the actual call after this
-- transaction commits. That means a slow or failing notification send
-- can never delay or roll back the bid insert itself (spec 4.7: "don't
-- block the real-time broadcast or UI update"), and a misconfigured
-- secret/URL below fails inside pg_net's worker, not inside place-bid's
-- request.
create extension if not exists pg_net;

-- Vault secrets store the two environment-specific values this trigger
-- needs to call dispatch-notification: the function's own URL (differs
-- between local and the hosted project) and the secret/service-role key
-- dispatch-notification's `auth: "secret"` mode requires. Created here
-- with placeholder values, same reasoning RESEND_API_KEY/OWNER_EMAIL are
-- never committed to git either — the real values are set separately,
-- per environment, after this migration runs (vault.update_secret()
-- locally via psql, the Management API's SQL endpoint for the hosted
-- project — see the task's own commit/backlog note for the exact
-- commands used).
select vault.create_secret(
  'unset',
  'dispatch_notification_url',
  'Full URL of the dispatch-notification Edge Function for this environment'
);

select vault.create_secret(
  'unset',
  'service_role_key',
  'Secret/service-role key used by Database Webhook trigger functions to authenticate to dispatch-notification (auth: secret mode)'
);

-- Plain SECURITY INVOKER (the default) — deliberately not SECURITY
-- DEFINER, keeping this project's established "no more authority than
-- the caller already has" pattern intact. This works here because the
-- only real caller is place-bid, which inserts Bids via its service-role
-- client — and service_role already has SELECT on vault.decrypted_secrets
-- and EXECUTE on net.http_post (verified directly, not assumed), so the
-- trigger needs no elevated privilege beyond what place-bid's own writes
-- already run with.
create function public.notify_on_bid_insert()
returns trigger
language plpgsql
as $$
declare
  v_tournament_id uuid;
  v_threshold numeric;
  v_player_user_id uuid;
  v_function_url text;
  v_service_key text;
  v_previous_high_bidder uuid;
  v_bidder record;
begin
  select p.tournament_id, t.threshold_amount, p.user_id
    into v_tournament_id, v_threshold, v_player_user_id
  from public.players p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = NEW.player_id;

  -- Both the `apikey` header (Kong's own API-key check, gating whether a
  -- request reaches an Edge Function at all) and the `Authorization`
  -- header (dispatch-notification's own `auth: "secret"` check, once
  -- Kong lets the request through) are required, and are two separate
  -- checks — verified directly that omitting `apikey` fails at Kong with
  -- 401 "Invalid credentials" before the function's own logic ever runs,
  -- same as every curl call elsewhere in this project already sets both.
  select decrypted_secret into v_function_url
  from vault.decrypted_secrets where name = 'dispatch_notification_url';

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets where name = 'service_role_key';

  -- Outbid: whoever held the highest non-voided bid on this player
  -- immediately before this one — i.e. the highest bid on this player
  -- excluding the row that was just inserted. Only fires when that
  -- bidder is someone other than whoever just placed NEW (a solo bidder
  -- raising their own price, if that were ever possible, shouldn't
  -- "outbid" themselves).
  select bidder_id into v_previous_high_bidder
  from public.bids
  where player_id = NEW.player_id
    and voided_at is null
    and id != NEW.id
  order by amount desc
  limit 1;

  if v_previous_high_bidder is not null and v_previous_high_bidder != NEW.bidder_id then
    perform net.http_post(
      url := v_function_url,
      body := jsonb_build_object(
        'userId', v_previous_high_bidder,
        'trigger', 'outbid',
        'tournamentId', v_tournament_id,
        'playerId', NEW.player_id,
        'amount', NEW.amount
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key,
        'apikey', v_service_key
      )
    );
  end if;

  -- Bid on you: the Player's linked User, if any, skipped when it's the
  -- bidder themselves — self-bidding is normal, deliberate Calcutta
  -- behavior (spec 4.9), so this just means no notification fires for
  -- that one bid, not that the bid itself is restricted.
  if v_player_user_id is not null and v_player_user_id != NEW.bidder_id then
    perform net.http_post(
      url := v_function_url,
      body := jsonb_build_object(
        'userId', v_player_user_id,
        'trigger', 'bid_on_you',
        'tournamentId', v_tournament_id,
        'playerId', NEW.player_id,
        'amount', NEW.amount
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key,
        'apikey', v_service_key
      )
    );
  end if;

  -- Player reserved: NEW.phase = 'silent' and NEW.amount >= threshold can
  -- only be true for the one bid that actually crosses it — once crossed,
  -- place-bid flips the player to 'reserved' and every subsequent bid on
  -- them is phase 'live' (see place-bid's own "no risk of double-
  -- reserving" comment) — so this condition is a reliable, sufficient
  -- test for "this is the reserving bid" without needing to inspect
  -- players.status directly. Fans out to every distinct non-voided
  -- bidder on this player, including whoever placed the reserving bid
  -- themselves — spec 4.7's trigger is "a player a Participant has bid
  -- on crosses the threshold", which is true for them too.
  if NEW.phase = 'silent' and NEW.amount >= v_threshold then
    for v_bidder in
      select distinct bidder_id from public.bids
      where player_id = NEW.player_id and voided_at is null
    loop
      perform net.http_post(
        url := v_function_url,
        body := jsonb_build_object(
          'userId', v_bidder.bidder_id,
          'trigger', 'reserved',
          'tournamentId', v_tournament_id,
          'playerId', NEW.player_id
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key,
          'apikey', v_service_key
        )
      );
    end loop;
  end if;

  return NEW;
end;
$$;

create trigger bids_notify_after_insert
after insert on public.bids
for each row execute function public.notify_on_bid_insert();
