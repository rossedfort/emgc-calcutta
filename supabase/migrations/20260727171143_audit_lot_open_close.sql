-- Phase 9 backlog: open_live_lot()/close_live_lot() are plain SECURITY
-- INVOKER functions, running with the caller's own privileges -- since
-- audit_events has zero client-writable policies (not even Admin/Owner can
-- INSERT directly), a SECURITY INVOKER function hits the same wall a
-- direct client insert would. Auditing "lot opened"/"lot sold" (spec 4.6's
-- own action list, and already present in $lib/auditActions.ts's
-- AUDIT_ACTIONS as placeholders nothing wrote yet) needs a narrowly-scoped
-- SECURITY DEFINER helper -- the *only* elevated capability granted is
-- "write an audit row," not a broader RLS bypass. Mirrors the pattern
-- call_dispatch_notification() (notification_dispatch_triggers migration)
-- already established for a different purpose (Vault secret access) -- not
-- a new pattern to introduce, just applied here for the first time.
--
-- Deliberately narrow: no p_actor_id/p_actor_identity params -- both are
-- always derived from the CALLING session (auth.uid()/auth.email()), never
-- caller-supplied, so nothing invoking this can forge an event attributed
-- to someone else. No p_ip/p_user_agent either -- unlike an Edge Function,
-- a Postgres function has no HTTP request to read those from; audit_events
-- already treats both as nullable for exactly this "not every event has
-- one" case. No p_reason -- neither lot_opened nor lot_sold needs one
-- (that's a bid-void concept); add it later if a future caller does.
create function public.log_audit_event(
  p_tournament_id uuid,
  p_player_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    tournament_id, player_id, actor_id, actor_identity,
    action, entity_type, entity_id, before, after
  )
  values (
    p_tournament_id, p_player_id, auth.uid(), auth.email(),
    p_action, p_entity_type, p_entity_id, p_before, p_after
  );
end;
$$;

-- Same caller set as the two functions below, the only ones granted use of
-- this helper for now -- not authenticated at large, so nothing else can
-- write an audit row just because it can call a SQL function.
grant execute on function public.log_audit_event(uuid, uuid, text, text, uuid, jsonb, jsonb) to authenticated;

-- Recreated in full to add the audit-log call and the target_player_id/
-- opened_ts locals it needs -- everything else (guards, the anti-snipe
-- closes_at calculation) is unchanged from the original.
create or replace function public.open_live_lot(lot_id uuid)
returns void
language plpgsql
as $$
declare
  target_tournament_id uuid;
  target_player_id uuid;
  snipe_seconds integer;
  already_open_count integer;
  started timestamptz;
  opened_ts timestamptz := now();
begin
  select tournament_id, player_id into target_tournament_id, target_player_id
  from public.live_lots
  where id = lot_id;

  if target_tournament_id is null then
    raise exception 'Lot not found';
  end if;

  select live_auction_started_at into started
  from public.tournaments
  where id = target_tournament_id;

  if started is null then
    raise exception 'The live auction hasn''t been started yet';
  end if;

  -- At most one lot open at a time per tournament — the participant/admin
  -- live screens both assume this. Checked here, not just relied on via the
  -- caller only offering an "advance" button when nothing's open, since the
  -- DB is the authoritative guard against a double-click or two Admins
  -- acting at once.
  select count(*) into already_open_count
  from public.live_lots
  where tournament_id = target_tournament_id
    and opened_at is not null
    and closed_at is null
    and id != lot_id;

  if already_open_count > 0 then
    raise exception 'Another lot is already open in this tournament';
  end if;

  select anti_snipe_seconds into snipe_seconds
  from public.tournaments
  where id = target_tournament_id;

  update public.live_lots
  set
    opened_at = opened_ts,
    -- anti_snipe_seconds <= 0 means anti-snipe is disabled for this
    -- tournament — closes_at is left null rather than set to a
    -- meaningless "now".
    closes_at = case
      when snipe_seconds > 0 then opened_ts + (snipe_seconds || ' seconds')::interval
      else null
    end
  where id = lot_id;

  -- An RLS-blocked UPDATE affects zero rows rather than raising an error —
  -- FOUND is set by the UPDATE above, so this turns a silent no-op into an
  -- explicit error instead of a misleading "it worked."
  if not found then
    raise exception 'Not permitted to open this lot';
  end if;

  perform public.log_audit_event(
    target_tournament_id, target_player_id, 'lot_opened', 'LiveLot', lot_id,
    null, jsonb_build_object('opened_at', opened_ts)
  );
end;
$$;

grant execute on function public.open_live_lot(uuid) to authenticated;

-- Recreated in full to add the audit-log call and the target_tournament_id/
-- before_status locals it needs -- everything else (the sold-vs-no_bid
-- derivation, the two guarded UPDATEs) is unchanged from the original.
create or replace function public.close_live_lot(lot_id uuid)
returns void
language plpgsql
as $$
declare
  target_tournament_id uuid;
  target_player_id uuid;
  before_status public.player_status;
  high_bid_id uuid;
  new_status public.player_status;
begin
  select tournament_id, player_id into target_tournament_id, target_player_id
  from public.live_lots
  where id = lot_id and opened_at is not null and closed_at is null;

  if target_player_id is null then
    raise exception 'Lot not found or not currently open';
  end if;

  select status into before_status
  from public.players
  where id = target_player_id;

  -- Same "current non-voided high bid" lookup place-bid itself uses — this
  -- is what makes the outcome auto-computed rather than a manual Admin
  -- choice between "Sold"/"No bid": a surviving bid means sold, no
  -- surviving bid (never bid, or every bid on it voided) means no_bid.
  select id into high_bid_id
  from public.bids
  where player_id = target_player_id and voided_at is null
  order by amount desc
  limit 1;

  new_status := case when high_bid_id is not null then 'sold_live' else 'no_bid' end;

  update public.live_lots
  set closed_at = now(), winning_bid_id = high_bid_id
  where id = lot_id;

  if not found then
    raise exception 'Not permitted to close this lot';
  end if;

  update public.players
  set status = new_status, winning_bid_id = high_bid_id
  where id = target_player_id;

  if not found then
    raise exception 'Not permitted to update this player';
  end if;

  perform public.log_audit_event(
    target_tournament_id, target_player_id, 'lot_sold', 'LiveLot', lot_id,
    jsonb_build_object('status', before_status),
    jsonb_build_object('status', new_status, 'winning_bid_id', high_bid_id)
  );
end;
$$;

grant execute on function public.close_live_lot(uuid) to authenticated;
