-- Silent and live auction phases never run concurrently (user feedback,
-- Phase 4.5): the live auction is a deliberate, manually-started event that
-- can only begin once the silent auction has already ended.
--
-- live_auction_started_at is nullable and starts null. It's set exactly
-- once, by start_live_auction() below, and never cleared — there's no
-- "pause"/"stop" concept, matching how silent_auction_end itself is a
-- one-way gate.
alter table public.tournaments
  add column live_auction_started_at timestamptz;

-- SECURITY INVOKER (the default) — same reasoning as swap_queue_position/
-- open_live_lot/close_live_lot: the existing tournaments_update_admin_owner
-- policy already lets Admin/Owner update this column directly, so this
-- function grants no more authority than the caller already has; it just
-- adds the two guards a plain client-side .update() can't express safely
-- on its own (can't start early, can't start twice).
create function public.start_live_auction(tournament_id uuid)
returns void
language plpgsql
as $$
declare
  silent_end timestamptz;
  already_started timestamptz;
begin
  select silent_auction_end, live_auction_started_at
    into silent_end, already_started
  from public.tournaments
  where id = tournament_id;

  if silent_end is null then
    raise exception 'Tournament not found';
  end if;

  if already_started is not null then
    raise exception 'The live auction has already been started';
  end if;

  if silent_end > now() then
    raise exception 'The silent auction hasn''t ended yet';
  end if;

  update public.tournaments
  set live_auction_started_at = now()
  where id = tournament_id;

  -- See open_live_lot/close_live_lot for why this check exists: an
  -- RLS-blocked UPDATE affects zero rows rather than raising on its own.
  if not found then
    raise exception 'Not permitted to start the live auction for this tournament';
  end if;
end;
$$;

grant execute on function public.start_live_auction(uuid) to authenticated;

-- open_live_lot now also requires the live auction to have actually been
-- started — otherwise a lot could be opened (and bid on) while the silent
-- auction is still technically running, or before an Admin has decided
-- the queue is ready. Recreated in full since plpgsql function bodies
-- can't be partially altered.
create or replace function public.open_live_lot(lot_id uuid)
returns void
language plpgsql
as $$
declare
  target_tournament_id uuid;
  snipe_seconds integer;
  already_open_count integer;
  started timestamptz;
begin
  select tournament_id into target_tournament_id
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
    closes_at = case
      when snipe_seconds > 0 then now() + (snipe_seconds || ' seconds')::interval
      else null
    end
  where id = lot_id;

  if not found then
    raise exception 'Not permitted to open this lot';
  end if;
end;
$$;
