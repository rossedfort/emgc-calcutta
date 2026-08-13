-- Re-opens a closed live lot for further bidding (Phase 38 mid-phase
-- addition): covers the case where an in-person bid comes in but the
-- Admin doesn't get it recorded before the anti-snipe timer hits 0s and
-- the lot auto-closes. Modeled directly on open_live_lot/close_live_lot's
-- shape (create_live_lots.sql) — same read-then-write atomicity need (a
-- plain PostgREST client can't do a dependent read+write across two
-- tables in one call), same "at most one open lot per tournament" guard,
-- same anti-snipe closes_at computation, same log_audit_event call.
--
-- Reverts live_lots.closed_at/winning_bid_id to null and opened_at/
-- closes_at to a fresh open window (exactly like open_live_lot does for a
-- lot opening for the first time), and player_entries.status back to
-- 'reserved' — the exact status the entry held immediately before
-- close_live_lot moved it to sold_live/no_bid, per that function's own
-- before_status capture — with winning_bid_id cleared. Existing bids are
-- never voided or otherwise touched; only the lot's open/closed state and
-- the entry's derived status/winning_bid_id change.
--
-- Safe against player_entries_notify_sold (notification_dispatch_triggers.sql):
-- that trigger only fires when NEW.status transitions *into*
-- sold_silent/sold_live, never out of it, so reverting to 'reserved' here
-- doesn't spuriously re-fire a "sold" notification. Also safe against the
-- flight/division validation trigger (create_player_entries.sql), which
-- doesn't touch status at all.
--
-- Plain SECURITY INVOKER (the default) — live_lots_write_admin_owner and
-- player_entries_update_admin_owner already let Admin/Owner make these
-- writes directly, so this grants no more authority than the caller
-- already has.
create function public.reopen_live_lot(lot_id uuid)
returns void
language plpgsql
as $$
declare
  target_tournament_id uuid;
  target_entry_id uuid;
  target_player_id uuid;
  before_status public.player_status;
  snipe_seconds integer;
  already_open_count integer;
  reopened_ts timestamptz := now();
begin
  select tournament_id, entry_id into target_tournament_id, target_entry_id
  from public.live_lots
  where id = lot_id and closed_at is not null;

  if target_tournament_id is null then
    raise exception 'Lot not found or not closed';
  end if;

  select player_id, status into target_player_id, before_status
  from public.player_entries
  where id = target_entry_id;

  -- Same "at most one lot open at a time" invariant open_live_lot enforces
  -- — the participant/admin live screens both assume this, and re-opening
  -- a second lot alongside one already open would violate it just as much
  -- as advancing a second one would.
  select count(*) into already_open_count
  from public.live_lots
  where tournament_id = target_tournament_id
    and opened_at is not null
    and closed_at is null;

  if already_open_count > 0 then
    raise exception 'Another lot is already open in this tournament';
  end if;

  select anti_snipe_seconds into snipe_seconds
  from public.tournaments
  where id = target_tournament_id;

  update public.live_lots
  set
    closed_at = null,
    winning_bid_id = null,
    opened_at = reopened_ts,
    closes_at = case
      when snipe_seconds > 0 then reopened_ts + (snipe_seconds || ' seconds')::interval
      else null
    end
  where id = lot_id;

  if not found then
    raise exception 'Not permitted to reopen this lot';
  end if;

  update public.player_entries
  set status = 'reserved', winning_bid_id = null
  where id = target_entry_id;

  if not found then
    raise exception 'Not permitted to update this entry';
  end if;

  perform public.log_audit_event(
    target_tournament_id, target_player_id, 'lot_reopened', 'LiveLot', lot_id,
    jsonb_build_object('status', before_status),
    jsonb_build_object('status', 'reserved', 'closed_at', null),
    target_entry_id
  );
end;
$$;

grant execute on function public.reopen_live_lot(uuid) to authenticated;
