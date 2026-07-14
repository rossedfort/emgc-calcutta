-- Open/close a live lot (spec 4.4). Both are read-then-write (need the
-- tournament's anti_snipe_seconds to open, need the current high bid to
-- close), same shape as swap_queue_position, and for the same reason:
-- a plain PostgREST client can't do a read followed by a dependent write
-- as one atomic call, and this genuinely needs to be atomic (no client-
-- visible half-state where a lot is "opened" without its countdown, or
-- "closed" without a resolved winner).
--
-- Both are plain SECURITY INVOKER (the default) — deliberately not
-- SECURITY DEFINER, same reasoning as swap_queue_position: the existing
-- live_lots_write_admin_owner and players_update_admin_owner RLS policies
-- already let Admin/Owner make these writes directly, so these functions
-- grant no more authority than the caller already has; a non-admin caller
-- invoking either RPC still hits the same RLS denial the underlying
-- UPDATE would give them directly.
create function public.open_live_lot(lot_id uuid)
returns void
language plpgsql
as $$
declare
  target_tournament_id uuid;
  snipe_seconds integer;
  already_open_count integer;
begin
  select tournament_id into target_tournament_id
  from public.live_lots
  where id = lot_id;

  if target_tournament_id is null then
    raise exception 'Lot not found';
  end if;

  -- At most one lot open at a time per tournament — the participant/admin
  -- live screens both assume this. Checked here, not just relied on via
  -- the caller only offering an "advance" button when nothing's open,
  -- since the DB is the authoritative guard against a double-click or
  -- two Admins acting at once.
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
    opened_at = now(),
    -- anti_snipe_seconds <= 0 means the tournament has anti-snipe
    -- disabled (spec: "can be disabled if a human auctioneer is calling
    -- it live") — same as place-bid's own reset logic, closes_at is left
    -- null rather than set to a meaningless "now".
    closes_at = case
      when snipe_seconds > 0 then now() + (snipe_seconds || ' seconds')::interval
      else null
    end
  where id = lot_id;

  -- An RLS-blocked UPDATE affects zero rows rather than raising an
  -- error — caught directly while testing this: a non-admin caller got
  -- back a plain success with nothing actually changed. FOUND is set by
  -- the UPDATE above (true iff it affected at least one row), so this
  -- turns that silent no-op into an explicit error instead of a
  -- misleading "it worked."
  if not found then
    raise exception 'Not permitted to open this lot';
  end if;
end;
$$;

grant execute on function public.open_live_lot(uuid) to authenticated;

create function public.close_live_lot(lot_id uuid)
returns void
language plpgsql
as $$
declare
  target_player_id uuid;
  high_bid_id uuid;
  new_status public.player_status;
begin
  select player_id into target_player_id
  from public.live_lots
  where id = lot_id and opened_at is not null and closed_at is null;

  if target_player_id is null then
    raise exception 'Lot not found or not currently open';
  end if;

  -- Same "current non-voided high bid" lookup place-bid itself uses —
  -- this is what makes the outcome auto-computed rather than a manual
  -- Admin choice between "Sold"/"No bid": a surviving bid means sold, no
  -- surviving bid (never bid, or every bid on it voided) means no_bid.
  -- In practice a live lot's player always has at least the silent bid
  -- that got them reserved, so "no_bid" here is only reachable if every
  -- bid on the player is later voided (the still-unbuilt bid-void task).
  select id into high_bid_id
  from public.bids
  where player_id = target_player_id and voided_at is null
  order by amount desc
  limit 1;

  new_status := case when high_bid_id is not null then 'sold_live' else 'no_bid' end;

  update public.live_lots
  set closed_at = now(), winning_bid_id = high_bid_id
  where id = lot_id;

  -- See the matching check in open_live_lot for why this is needed: an
  -- RLS-blocked UPDATE affects zero rows rather than raising an error on
  -- its own.
  if not found then
    raise exception 'Not permitted to close this lot';
  end if;

  update public.players
  set status = new_status
  where id = target_player_id;

  if not found then
    raise exception 'Not permitted to update this player';
  end if;
end;
$$;

grant execute on function public.close_live_lot(uuid) to authenticated;
