-- Phase 3: Bid records for the silent and live auctions (spec 4.3/4.4).
-- No ON DELETE cascade on either FK: a Bid is a financial record (who owes
-- what, who won what — spec 4.8), so a Player or User that already has bids
-- against them should block deletion (Postgres's default NO ACTION) rather
-- than silently destroying auction history. In practice this means the
-- existing "remove player" admin action (Phase 2) will fail once a player
-- has any bids, which is the desired behavior — not something to "fix" by
-- adding a cascade later.
create type bid_phase as enum ('silent', 'live');

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id),
  bidder_id uuid not null references public.users (id),
  amount numeric(10, 2) not null,
  phase bid_phase not null,
  placed_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);

create index bids_player_id_idx on public.bids (player_id);
create index bids_bidder_id_idx on public.bids (bidder_id);

alter table public.bids enable row level security;

grant select, insert, update, delete on public.bids to authenticated;
grant select, insert, update, delete on public.bids to service_role;

-- RLS is enabled with zero policies for now — deliberately, matching the
-- Tournament table's original migration. Reads (spec 6.5: Participants can
-- read Bid for tournaments they can see) are the very next backlog task.
-- Writes never get a client-writable policy at all, ever: every bid goes
-- through the place-bid Edge Function (a later task), which validates
-- against current state under concurrent writes before writing via the
-- service-role client — something RLS can't safely express on its own.
