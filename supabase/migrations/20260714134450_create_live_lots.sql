-- Phase 4: the live-auction queue (spec 4.4/5). One row per reserved
-- player as they come up for live bidding, in Admin-controlled order.
--
-- No explicit status column — outcome is derived from timestamp/FK
-- nullability, mirroring the rest of the schema's bias toward derived
-- rather than stored state:
--   opened_at null                        -> still queued, not yet up
--   opened_at set, closed_at null         -> currently open for bidding
--   closed_at set, winning_bid_id set     -> sold
--   closed_at set, winning_bid_id null    -> no bid
--
-- closes_at is the anti-snipe countdown target (spec 4.4/182): set when
-- the lot opens and reset by place-bid whenever a new bid lands inside
-- the window, so clients can count down from a synced value with no
-- server-side timer process. Not listed in spec 5's summary table (an
-- omission there — 182's anti-snipe discussion explicitly names
-- LiveLot.closesAt), but needed from the start since adding it later
-- would just mean an ALTER TABLE anyway.
--
-- player_id has no ON DELETE cascade, same reasoning as Bid: a lot that
-- reached bidding carries real auction history (via winning_bid_id),
-- so a Player with live-lot history should block deletion rather than
-- silently losing it. tournament_id does cascade, matching Player's own
-- FK — deleting a Tournament (an Owner-only, rarely-used action) takes
-- its whole operational record with it.
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
create unique index live_lots_tournament_id_queue_position_key
  on public.live_lots (tournament_id, queue_position);

alter table public.live_lots enable row level security;

grant select, insert, update, delete on public.live_lots to authenticated;
grant select, insert, update, delete on public.live_lots to service_role;

-- Reads only, same visibility rule as players/bids: Admin/Owner see every
-- lot; Participants see lots in tournaments they can see at all
-- (kind='production'), not just lots for players they're bidding on —
-- spec 4.5 requires every connected client to see lot state (opened,
-- closed, current high) in near-real-time during the live event.
--
-- No write policy yet, deliberately: Admin-only lot open/close writes
-- (simple state changes — advance the queue, mark sold/no-bid) are a
-- separate, later backlog task that adds those via plain RLS, not an
-- Edge Function (spec explicitly calls this out, unlike place-bid's
-- validation-heavy writes). Nothing here ever needs a write policy for
-- Participants — live bids themselves land in Bid via place-bid, same
-- as the silent auction, not in this table.
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

-- Adding this to the Realtime publication now rather than waiting to
-- discover the gap while building the frontend consumer, the way it
-- played out for bids/players in Phase 3 — same fix, applied proactively
-- this time since the cost is zero and the lesson's already paid for.
alter publication supabase_realtime add table public.live_lots;
