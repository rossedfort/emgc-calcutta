-- Phase 11: splits Player identity from the sellable/biddable auction unit.
--
-- Until now, `players` was both a competitor's identity (name, flight,
-- handicap, user_id link) AND the atomic sellable unit (status,
-- winning_bid_id, placement, buyer_marked_paid_at/by) at once — a single
-- row can't represent "gross is sold, net is still open" simultaneously, so
-- a Championship-flight golfer was represented as two entirely independent
-- `players` rows (Phase 7.5), with no real FK between them. Everything that
-- needed to treat those two rows as "the same golfer" had to fuzzy-match by
-- (tournament_id, flight, first_name, last_name) instead — reimplemented
-- five separate times across self-link/unlink, the admin edit page's
-- link/unlink actions, and the self-link dropdown's dedup filter (Phases
-- 10.6/10.10). This migration is the structural fix: `players` becomes
-- pure identity (one row per real competitor, one slug), and this new
-- `player_entries` table becomes the sellable unit — one row per
-- independently-biddable division, with a real FK back to its player.
--
-- `tournament_id`/`flight` are denormalized onto `player_entries` (not just
-- reachable via player_id) so the placement-uniqueness and RLS checks below
-- can stay real Postgres unique indexes/direct column checks rather than
-- needing to reach through a join to another table's columns for every
-- check — a unique index can't span a join. `tournament_id` never changes
-- post-creation; `flight` can (the admin edit form allows it), so a sync
-- trigger further down keeps every entry's denormalized flight in step
-- with its player's.
--
-- No data migration/backfill in this file: this repo's production project
-- is confirmed unused (no real data to preserve — see the Phase 10.7/10.8
-- migration-squash work, which already established the precedent of a full
-- local + remote `db reset` rather than an in-place ALTER+backfill), so
-- every table below is empty at the point this migration actually runs.
-- This migration is deliberately its own fresh migration, not squashed into
-- the original create_players.sql/create_bids.sql/etc. — squashing it back
-- in is its own later Phase 11 task, once everything here is verified
-- working, matching this session's established squash-after-it-works
-- precedent rather than trying to do both at once.
--
-- Scope note: this migration also updates every Postgres function/trigger
-- that would otherwise break immediately on its own — most importantly
-- close_silent_auctions(), which runs via pg_cron every 60 seconds
-- regardless of whether anyone uses the app, so leaving it referencing
-- dropped columns isn't a valid intermediate state to commit. It does NOT
-- touch link_self_to_player()/unlink_self_from_player() (still reference
-- players.division for their now-obsolete sibling-matching logic) or any
-- Edge Function (place-bid, void-bid, mark-bid-paid, mark-payout-paid,
-- set-placement, import-csv-confirm) or frontend code — those only break
-- when actually exercised (a click, an invocation), not automatically, so
-- they're correctly left for their own later, independently-verifiable
-- tasks rather than folded in here.

-- ============================================================
-- 1. player_entries: the new sellable-unit table
-- ============================================================

create table public.player_entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  -- Denormalized from players — see the header comment for why. Kept in
  -- sync by players_sync_entries_flight below whenever a player's own
  -- flight/tournament_id changes.
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  flight text not null default '',
  division text not null default 'overall' check (division in ('overall', 'gross', 'net')),
  status public.player_status not null default 'open',
  winning_bid_id uuid references public.bids (id) on delete set null,
  placement integer check (placement > 0),
  buyer_marked_paid_at timestamptz,
  buyer_marked_paid_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Same ties-disallowed-per-flight/division reasoning as the original
-- players_tournament_id_placement_key index this replaces.
create unique index player_entries_tournament_id_placement_key
  on public.player_entries (tournament_id, flight, division, placement);

create index player_entries_player_id_idx on public.player_entries (player_id);
create index player_entries_winning_bid_id_idx on public.player_entries (winning_bid_id);
create index player_entries_buyer_marked_paid_by_idx on public.player_entries (buyer_marked_paid_by);

alter table public.player_entries enable row level security;

grant select, insert, update, delete on public.player_entries to authenticated;
grant select, insert, update, delete on public.player_entries to service_role;

-- Status changes need to keep broadcasting in real time exactly like
-- players.status did before (the auction boards' Realtime store subscribes
-- to see a player flip to reserved/sold live) — this table takes over that
-- role.
alter publication supabase_realtime add table public.player_entries;

-- Mirrors players' own four policies exactly (same role-based shape, just
-- checking player_entries.tournament_id directly instead of needing to
-- reach it through a join, now that it's denormalized).
create policy "player_entries_select_participant_plus" on public.player_entries
for select to authenticated
using (
  public.current_user_role() in ('admin', 'owner')
  or (
    public.current_user_role() = 'participant'
    and exists (
      select 1 from public.tournaments t
      where t.id = player_entries.tournament_id and t.kind = 'production'
    )
  )
);

create policy "player_entries_insert_admin_owner" on public.player_entries
for insert to authenticated
with check (public.current_user_role() in ('admin', 'owner'));

create policy "player_entries_update_admin_owner" on public.player_entries
for update to authenticated
using (public.current_user_role() in ('admin', 'owner'))
with check (public.current_user_role() in ('admin', 'owner'));

create policy "player_entries_delete_admin_owner" on public.player_entries
for delete to authenticated
using (public.current_user_role() in ('admin', 'owner'));

-- ============================================================
-- 2. Flight/division validation splits in two: flight-membership stays a
--    players-level concern (a player's flight must be one of the
--    tournament's configured flights, regardless of divisions); the
--    division-vs-championship_flight derivation moves to player_entries
--    (using its own denormalized flight). Shared helper avoids the two
--    triggers drifting out of sync on the flight-membership rule.
-- ============================================================

create function public.validate_flight_membership(p_tournament_id uuid, p_flight text)
returns void
language plpgsql
as $$
declare
  v_flights text[];
begin
  if p_flight = '' then
    return;
  end if;

  select flights into v_flights from public.tournaments where id = p_tournament_id;

  if not (p_flight = any (v_flights)) then
    raise exception
      'Flight "%" is not configured for this tournament. Add it to the tournament''s flights list first.',
      p_flight;
  end if;
end;
$$;

drop trigger players_validate_flight_division on public.players;
drop function public.validate_player_flight_division();

create function public.validate_player_flight()
returns trigger
language plpgsql
as $$
begin
  perform public.validate_flight_membership(NEW.tournament_id, NEW.flight);
  return NEW;
end;
$$;

create trigger players_validate_flight
before insert or update of flight, tournament_id on public.players
for each row
execute function public.validate_player_flight();

create function public.validate_entry_flight_division()
returns trigger
language plpgsql
as $$
declare
  v_championship_flight text;
begin
  perform public.validate_flight_membership(NEW.tournament_id, NEW.flight);

  select championship_flight into v_championship_flight
  from public.tournaments
  where id = NEW.tournament_id;

  if v_championship_flight is not null and NEW.flight = v_championship_flight then
    if NEW.division not in ('gross', 'net') then
      raise exception
        'Entries in the Championship flight ("%") must have a division of ''gross'' or ''net'', not ''%''.',
        v_championship_flight, NEW.division;
    end if;
  else
    if NEW.division != 'overall' then
      raise exception
        'Division ''%'' is only valid for an entry in the Championship flight; this entry''s flight is "%".',
        NEW.division, NEW.flight;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger player_entries_validate_flight_division
before insert or update of flight, division, tournament_id on public.player_entries
for each row
execute function public.validate_entry_flight_division();

-- Keeps every entry's denormalized flight/tournament_id in step with its
-- player's own — confirmed the admin edit form does allow changing a
-- player's flight after creation (tournament_id reassignment has no actual
-- UI path today, same "currently theoretical" status the original
-- players_validate_flight_division trigger already called out, but synced
-- here too for the same reason it was validated for there). Runs after
-- players' own before-trigger has already validated the new flight, and
-- feeds straight into player_entries' own before-trigger re-validating it
-- there (redundant for flight-membership, necessary for division
-- re-derivation) — both checks stay correct with no special-casing needed.
create function public.sync_player_entries_flight()
returns trigger
language plpgsql
as $$
begin
  update public.player_entries
  set flight = NEW.flight, tournament_id = NEW.tournament_id
  where player_id = NEW.id;
  return NEW;
end;
$$;

create trigger players_sync_entries_flight
after update of flight, tournament_id on public.players
for each row
execute function public.sync_player_entries_flight();

-- ============================================================
-- 3. Repoint bids/live_lots/payouts/audit_events at player_entries.
--    Renamed player_id -> entry_id on all three (not left named player_id
--    while pointing at a different table) — a bid's player_id silently no
--    longer matching any players.id would be exactly the kind of quiet,
--    confusing footgun this whole redesign exists to get rid of.
-- ============================================================

-- bids: bids_select_participant_plus's USING clause references
-- bids.player_id directly, which would block dropping that column while
-- the policy still exists — drop and recreate around the column swap.
drop policy "bids_select_participant_plus" on public.bids;

alter table public.bids add column entry_id uuid not null references public.player_entries (id);
create index bids_entry_id_idx on public.bids (entry_id);
alter table public.bids drop column player_id;

create policy "bids_select_participant_plus" on public.bids
for select to authenticated
using (
  public.current_user_role() in ('admin', 'owner')
  or (
    public.current_user_role() = 'participant'
    and exists (
      select 1 from public.player_entries e
      join public.tournaments t on t.id = e.tournament_id
      where e.id = bids.entry_id and t.kind = 'production'
    )
  )
);

-- live_lots: live_lots_select_participant_plus only checks
-- live_lots.tournament_id (its own column, unaffected) — no policy
-- drop/recreate needed here.
alter table public.live_lots add column entry_id uuid not null references public.player_entries (id);
create index live_lots_entry_id_idx on public.live_lots (entry_id);
alter table public.live_lots drop column player_id;

-- payouts: payouts_select_self_or_admin_owner only checks bidder_id/role —
-- no policy drop/recreate needed here either. payouts_player_id_key's
-- one-payout-per-sellable-unit uniqueness moves to entry_id.
alter table public.payouts add column entry_id uuid not null references public.player_entries (id);
alter table public.payouts drop column player_id;
create unique index payouts_entry_id_key on public.payouts (entry_id);

-- audit_events: entry_id is new and additional, not a replacement for
-- player_id — player_id stays populated for every player-related event
-- (resolved to the golfer's identity row even for entry-scoped events, by
-- callers passing it explicitly) so "filter the audit log by this golfer"
-- keeps working across their whole history regardless of which specific
-- entry an event concerned; entry_id is populated only for events actually
-- about one specific sellable unit.
alter table public.audit_events add column entry_id uuid references public.player_entries (id) on delete set null;
create index audit_events_entry_id_idx on public.audit_events (entry_id);

-- ============================================================
-- 4. Drop the now-migrated columns off players. Auto-drops the old
--    players_tournament_id_placement_key index (referenced flight+
--    division+placement — division is going), the old
--    (tournament_id, user_id, division) constraint (referenced division),
--    players_winning_bid_id_idx, and players_buyer_marked_paid_by_idx (all
--    structurally tied to the columns being dropped, so no explicit drop
--    statements needed for any of them). The old (tournament_id, user_id,
--    division) link-uniqueness constraint is replaced with a plain
--    (tournament_id, user_id) one — the division-scoped relaxation that
--    let one account link to both a Championship golfer's gross and net
--    rows no longer means anything once one player row IS the golfer;
--    "one player per tournament" is now correct for every player, not just
--    ordinary-flight ones.
--
--    players_notify_sold's WHEN clause reads NEW.status/NEW.winning_bid_id,
--    both about to be dropped — must be dropped before the columns
--    themselves, same reasoning as the bids policy above. Recreated on
--    player_entries in section 6 below.
-- ============================================================

drop trigger players_notify_sold on public.players;

alter table public.players
  drop column division,
  drop column status,
  drop column winning_bid_id,
  drop column placement,
  drop column buyer_marked_paid_at,
  drop column buyer_marked_paid_by,
  add constraint players_tournament_id_user_id_key unique (tournament_id, user_id);

-- ============================================================
-- 5. log_audit_event(): new trailing p_entry_id param, defaulted so every
--    existing call site (link_self_to_player, unlink_self_from_player —
--    untouched in this migration, see the header note) keeps working
--    unchanged, populating only player_id as it always has.
-- ============================================================

create or replace function public.log_audit_event(
  p_tournament_id uuid,
  p_player_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_entry_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    tournament_id, player_id, entry_id, actor_id, actor_identity,
    action, entity_type, entity_id, before, after
  )
  values (
    p_tournament_id, p_player_id, p_entry_id, auth.uid(), auth.email(),
    p_action, p_entity_type, p_entity_id, p_before, p_after
  );
end;
$$;

-- ============================================================
-- 6. Auction-lifecycle Postgres functions/triggers: same logic as before,
--    now reading/writing player_entries instead of players wherever
--    status/winning_bid_id/division/flight is involved.
-- ============================================================

create or replace function public.close_silent_auctions()
returns void
language sql
as $$
  update public.player_entries e
  set
    status = case
      when (
        select b.id from public.bids b
        where b.entry_id = e.id and b.voided_at is null
        order by b.amount desc limit 1
      ) is not null then 'sold_silent'::public.player_status
      else 'no_bid'::public.player_status
    end,
    winning_bid_id = (
      select b.id
      from public.bids b
      where b.entry_id = e.id and b.voided_at is null
      order by b.amount desc
      limit 1
    )
  from public.tournaments t
  where e.tournament_id = t.id
    and e.status = 'open'
    and t.silent_auction_end < now();
$$;

create or replace function public.open_live_lot(lot_id uuid)
returns void
language plpgsql
as $$
declare
  target_tournament_id uuid;
  target_entry_id uuid;
  target_player_id uuid;
  snipe_seconds integer;
  already_open_count integer;
  started timestamptz;
  opened_ts timestamptz := now();
begin
  select tournament_id, entry_id into target_tournament_id, target_entry_id
  from public.live_lots
  where id = lot_id;

  if target_tournament_id is null then
    raise exception 'Lot not found';
  end if;

  select player_id into target_player_id
  from public.player_entries
  where id = target_entry_id;

  select live_auction_started_at into started
  from public.tournaments
  where id = target_tournament_id;

  if started is null then
    raise exception 'The live auction hasn''t been started yet';
  end if;

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
    closes_at = case
      when snipe_seconds > 0 then opened_ts + (snipe_seconds || ' seconds')::interval
      else null
    end
  where id = lot_id;

  if not found then
    raise exception 'Not permitted to open this lot';
  end if;

  perform public.log_audit_event(
    target_tournament_id, target_player_id, 'lot_opened', 'LiveLot', lot_id,
    null, jsonb_build_object('opened_at', opened_ts),
    target_entry_id
  );
end;
$$;

create or replace function public.close_live_lot(lot_id uuid)
returns void
language plpgsql
as $$
declare
  target_tournament_id uuid;
  target_entry_id uuid;
  target_player_id uuid;
  before_status public.player_status;
  high_bid_id uuid;
  new_status public.player_status;
begin
  select tournament_id, entry_id into target_tournament_id, target_entry_id
  from public.live_lots
  where id = lot_id and opened_at is not null and closed_at is null;

  if target_entry_id is null then
    raise exception 'Lot not found or not currently open';
  end if;

  select status, player_id into before_status, target_player_id
  from public.player_entries
  where id = target_entry_id;

  select id into high_bid_id
  from public.bids
  where entry_id = target_entry_id and voided_at is null
  order by amount desc
  limit 1;

  new_status := case when high_bid_id is not null then 'sold_live' else 'no_bid' end;

  update public.live_lots
  set closed_at = now(), winning_bid_id = high_bid_id
  where id = lot_id;

  if not found then
    raise exception 'Not permitted to close this lot';
  end if;

  update public.player_entries
  set status = new_status, winning_bid_id = high_bid_id
  where id = target_entry_id;

  if not found then
    raise exception 'Not permitted to update this entry';
  end if;

  perform public.log_audit_event(
    target_tournament_id, target_player_id, 'lot_sold', 'LiveLot', lot_id,
    jsonb_build_object('status', before_status),
    jsonb_build_object('status', new_status, 'winning_bid_id', high_bid_id),
    target_entry_id
  );
end;
$$;

-- p_player_id param name deliberately left unchanged (not renamed to
-- p_entry_id) even though the value passed in is now an entry id — this
-- function is still called by place-bid with this exact named parameter,
-- and place-bid itself isn't updated until its own later Phase 11 task.
-- Renaming the SQL-side parameter now would break that call today for no
-- benefit yet.
create or replace function public.enqueue_player_for_live_auction(
  p_tournament_id uuid,
  p_player_id uuid
)
returns void
language plpgsql
as $$
declare
  next_position integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_tournament_id::text));

  select coalesce(max(queue_position), 0) + 1 into next_position
  from public.live_lots
  where tournament_id = p_tournament_id;

  insert into public.live_lots (tournament_id, entry_id, queue_position)
  values (p_tournament_id, p_player_id, next_position);
end;
$$;

-- ============================================================
-- 7. Notification triggers. 'playerId' in every dispatch-notification
--    payload below is deliberately resolved to the golfer's players.id
--    (via entry.player_id), not the entry id — dispatch-notification
--    itself isn't updated in this migration (it's an Edge Function, out of
--    scope here per the header note) and still looks up a name via
--    players.id, so keeping this payload field's meaning unchanged keeps
--    it working correctly. Known, flagged tradeoff: a Championship
--    golfer's outbid/reserved/won emails temporarily lose the Gross-vs-Net
--    distinction in the copy until dispatch-notification is itself
--    revisited in a later task — not a regression introduced silently.
-- ============================================================

create or replace function public.notify_on_bid_insert()
returns trigger
language plpgsql
as $$
declare
  v_tournament_id uuid;
  v_threshold numeric;
  v_player_id uuid;
  v_player_user_id uuid;
  v_kind text;
  v_previous_high_bidder uuid;
  v_bidder record;
begin
  select e.tournament_id, t.threshold_amount, e.player_id, pl.user_id, t.kind
    into v_tournament_id, v_threshold, v_player_id, v_player_user_id, v_kind
  from public.player_entries e
  join public.tournaments t on t.id = e.tournament_id
  join public.players pl on pl.id = e.player_id
  where e.id = NEW.entry_id;

  if v_kind != 'production' then
    return NEW;
  end if;

  select bidder_id into v_previous_high_bidder
  from public.bids
  where entry_id = NEW.entry_id
    and voided_at is null
    and id != NEW.id
  order by amount desc
  limit 1;

  if v_previous_high_bidder is not null and v_previous_high_bidder != NEW.bidder_id then
    perform public.call_dispatch_notification(jsonb_build_object(
      'userId', v_previous_high_bidder,
      'trigger', 'outbid',
      'tournamentId', v_tournament_id,
      'playerId', v_player_id,
      'amount', NEW.amount
    ));
  end if;

  if v_player_user_id is not null and v_player_user_id != NEW.bidder_id then
    perform public.call_dispatch_notification(jsonb_build_object(
      'userId', v_player_user_id,
      'trigger', 'bid_on_you',
      'tournamentId', v_tournament_id,
      'playerId', v_player_id,
      'amount', NEW.amount
    ));
  end if;

  if NEW.phase = 'silent' and NEW.amount >= v_threshold then
    for v_bidder in
      select distinct bidder_id from public.bids
      where entry_id = NEW.entry_id and voided_at is null
    loop
      perform public.call_dispatch_notification(jsonb_build_object(
        'userId', v_bidder.bidder_id,
        'trigger', 'reserved',
        'tournamentId', v_tournament_id,
        'playerId', v_player_id
      ));
    end loop;
  end if;

  return NEW;
end;
$$;

create or replace function public.notify_on_live_auction_starting()
returns trigger
language plpgsql
as $$
declare
  v_participant record;
begin
  for v_participant in
    select distinct pl.user_id
    from public.player_entries e
    join public.players pl on pl.id = e.player_id
    where e.tournament_id = NEW.id and e.status = 'reserved' and pl.user_id is not null
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
  where entry_id = NEW.id and voided_at is null
  order by amount desc
  limit 1;

  if v_winning_bid.bidder_id is not null then
    perform public.call_dispatch_notification(jsonb_build_object(
      'userId', v_winning_bid.bidder_id,
      'trigger', 'won',
      'tournamentId', NEW.tournament_id,
      'playerId', NEW.player_id,
      'amount', v_winning_bid.amount
    ));
  end if;
  return NEW;
end;
$$;

-- Moved from players to player_entries — same WHEN condition (a status
-- transition into a sold state, or winning_bid_id changing while already
-- sold, per void-bid's confirmed auto-fall-through recompute), just
-- against the table these columns now live on.
create trigger player_entries_notify_sold
after update on public.player_entries
for each row
when (
  NEW.status in ('sold_silent', 'sold_live')
  and (OLD.status is distinct from NEW.status or OLD.winning_bid_id is distinct from NEW.winning_bid_id)
)
execute function public.notify_on_player_sold();
