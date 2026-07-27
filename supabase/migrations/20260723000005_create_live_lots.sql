-- LiveLot (spec 4.4/5): the live-auction queue. One row per reserved player
-- as they come up for live bidding, in Admin-controlled order.
--
-- No explicit status column — outcome is derived from timestamp/FK
-- nullability, mirroring the rest of the schema's bias toward derived
-- rather than stored state:
--   opened_at null                     -> still queued, not yet up
--   opened_at set, closed_at null       -> currently open for bidding
--   closed_at set, winning_bid_id set   -> sold
--   closed_at set, winning_bid_id null  -> no bid
--
-- closes_at is the anti-snipe countdown target (spec 4.4/182): set when the
-- lot opens and reset by place-bid whenever a new bid lands inside the
-- window, so clients can count down from a synced value with no
-- server-side timer process.
--
-- player_id has no ON DELETE cascade, same reasoning as Bid: a lot that
-- reached bidding carries real auction history (via winning_bid_id), so a
-- Player with live-lot history should block deletion rather than silently
-- losing it. tournament_id does cascade, matching Player's own FK.
create table public.live_lots (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.players (id),
  queue_position integer not null,
  opened_at timestamptz,
  closed_at timestamptz,
  closes_at timestamptz,
  winning_bid_id uuid references public.bids (id) on delete set null
);

create index live_lots_tournament_id_idx on public.live_lots (tournament_id);
create index live_lots_player_id_idx on public.live_lots (player_id);

-- Deferrable: reordering the queue means swapping two rows' queue_position,
-- which under a plain (immediate) unique constraint can't be done as a
-- two-statement (or single UPDATE...CASE) transaction — Postgres checks a
-- non-deferred unique constraint as each row is written within a
-- statement, not once at end-of-transaction. Deferring the check to
-- end-of-transaction is what makes swap_queue_position/resequence_queue
-- below actually work.
alter table public.live_lots
  add constraint live_lots_tournament_id_queue_position_key
  unique (tournament_id, queue_position) deferrable initially deferred;

alter table public.live_lots enable row level security;

grant select, insert, update, delete on public.live_lots to authenticated;
grant select, insert, update, delete on public.live_lots to service_role;

alter publication supabase_realtime add table public.live_lots;

-- Reads only, same visibility rule as players/bids: Admin/Owner see every
-- lot; Participants see lots in tournaments they can see at all
-- (kind='production'), not just lots for players they're bidding on — spec
-- 4.5 requires every connected client to see lot state (opened, closed,
-- current high) in near-real-time during the live event.
create policy "live_lots_select_participant_plus" on public.live_lots
for select to authenticated
using (
  public.current_user_role() in ('admin', 'owner')
  or (
    public.current_user_role() = 'participant'
    and exists (
      select 1 from public.tournaments t
      where t.id = live_lots.tournament_id and t.kind = 'production'
    )
  )
);

-- Admin-only writes for building/reordering the live auction queue and for
-- opening/closing lots — simple state changes, not validation-heavy like
-- place-bid, so plain RLS-permitted writes rather than an Edge Function.
-- No additional tournament-kind check (unlike the select policy): Admin/
-- Owner already see and can act on every tournament regardless of kind.
create policy "live_lots_write_admin_owner" on public.live_lots
for all to authenticated
using (public.current_user_role() in ('admin', 'owner'))
with check (public.current_user_role() in ('admin', 'owner'));

-- Swaps two lots' queue_position atomically. Plain SECURITY INVOKER (the
-- default) — the write policy above already lets Admin/Owner update these
-- rows directly, so this function grants no more authority than the caller
-- already has; it just makes the swap possible in one transaction from a
-- single RPC call (a plain PostgREST client can't wrap two separate
-- .update() calls in one transaction on its own).
create function public.swap_queue_position(lot_a uuid, lot_b uuid)
returns void
language plpgsql
as $$
declare
  pos_a integer;
  pos_b integer;
begin
  select queue_position into pos_a from public.live_lots where id = lot_a;
  select queue_position into pos_b from public.live_lots where id = lot_b;

  if pos_a is null or pos_b is null then
    raise exception 'Both lots must exist';
  end if;

  update public.live_lots set queue_position = pos_b where id = lot_a;
  update public.live_lots set queue_position = pos_a where id = lot_b;
end;
$$;

grant execute on function public.swap_queue_position(uuid, uuid) to authenticated;

-- Bulk one-click resorts (Handicap ascending/descending, Shuffle) on top of
-- the manual up/down reordering above. The sort comparison itself happens
-- client-side against data it already has; this function's only job is to
-- rewrite every given lot's queue_position to match the order it's handed,
-- atomically. Takes the *entire* desired order as one array rather than one
-- pair at a time, so it validates that array is exactly the tournament's
-- current not-yet-opened lots (no more, no fewer) — catches a stale
-- client-side list as an explicit error instead of silently dropping a lot
-- from the queue or leaving stray positions.
--
-- Reassigns the *existing* set of position values the not-yet-opened lots
-- already occupy (e.g. {3,4,5,6}), permuted into the caller's order, rather
-- than renumbering to a fresh 1..N range — the unique constraint above is
-- unique across the *whole* tournament, not just the unopened subset, so
-- renumbering down to 1..N would collide with positions already held by
-- opened/closed lots once any lot has been opened. Reassigning only the
-- positions the unopened subset already owns can never collide, no matter
-- how many lots have already been opened.
create function public.resequence_queue(
  p_tournament_id uuid,
  p_ordered_lot_ids uuid[]
)
returns void
language plpgsql
as $$
declare
  existing_positions integer[];
  expected_count integer;
  given_count integer;
begin
  select array_agg(queue_position order by queue_position) into existing_positions
  from public.live_lots
  where tournament_id = p_tournament_id and opened_at is null;

  expected_count := coalesce(array_length(existing_positions, 1), 0);
  given_count := coalesce(array_length(p_ordered_lot_ids, 1), 0);

  if given_count != expected_count then
    raise exception
      'Ordered list has % lots but % are actually queued — try again',
      given_count, expected_count;
  end if;

  if exists (
    select 1
    from unnest(p_ordered_lot_ids) as given(lot_id)
    left join public.live_lots l
      on l.id = given.lot_id
      and l.tournament_id = p_tournament_id
      and l.opened_at is null
    where l.id is null
  ) then
    raise exception 'Ordered list contains a lot that is not queued in this tournament';
  end if;

  update public.live_lots as l
  set queue_position = existing_positions[o.ordinality]
  from unnest(p_ordered_lot_ids) with ordinality as o(lot_id, ordinality)
  where l.id = o.lot_id;
end;
$$;

grant execute on function public.resequence_queue(uuid, uuid[]) to authenticated;

-- Queues a player for the live auction the moment they cross the reserve
-- threshold during the silent auction (called from place-bid, in the same
-- transaction that reserves them — no Admin hand-add step).
--
-- Uses an advisory lock rather than relying on the deferred unique
-- constraint above: this function has to *compute* the next queue_position
-- by reading the current max, and two players crossing the threshold at
-- the same instant (different players, same tournament) could otherwise
-- both compute the same "next" position from two concurrent transactions
-- before either commits — the deferred constraint only serializes multiple
-- statements *within* one transaction, not across two. Locking on the
-- tournament id serializes exactly the two calls that could actually
-- collide, without blocking unrelated tournaments.
--
-- SECURITY INVOKER (the default) — grants no more authority than the
-- caller already has. Called from place-bid using the service-role client,
-- so it needs an explicit grant to service_role — table grants don't imply
-- function grants.
create function public.enqueue_player_for_live_auction(
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

  insert into public.live_lots (tournament_id, player_id, queue_position)
  values (p_tournament_id, p_player_id, next_position);
end;
$$;

grant execute on function public.enqueue_player_for_live_auction(uuid, uuid) to service_role;

-- Open/close a live lot (spec 4.4). Both are read-then-write (need the
-- tournament's anti_snipe_seconds/live_auction_started_at to open, need the
-- current high bid to close), same shape as swap_queue_position and for the
-- same reason: a plain PostgREST client can't do a read followed by a
-- dependent write as one atomic call, and this genuinely needs to be atomic
-- (no client-visible half-state where a lot is "opened" without its
-- countdown, or "closed" without a resolved winner).
--
-- Both are plain SECURITY INVOKER (the default) — the existing
-- live_lots_write_admin_owner and players_update_admin_owner RLS policies
-- already let Admin/Owner make these writes directly, so these functions
-- grant no more authority than the caller already has; a non-admin caller
-- invoking either RPC still hits the same RLS denial the underlying UPDATE
-- would give them directly.
create function public.open_live_lot(lot_id uuid)
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
    opened_at = now(),
    -- anti_snipe_seconds <= 0 means anti-snipe is disabled for this
    -- tournament — closes_at is left null rather than set to a
    -- meaningless "now".
    closes_at = case
      when snipe_seconds > 0 then now() + (snipe_seconds || ' seconds')::interval
      else null
    end
  where id = lot_id;

  -- An RLS-blocked UPDATE affects zero rows rather than raising an error —
  -- FOUND is set by the UPDATE above, so this turns a silent no-op into an
  -- explicit error instead of a misleading "it worked."
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
end;
$$;

grant execute on function public.close_live_lot(uuid) to authenticated;
