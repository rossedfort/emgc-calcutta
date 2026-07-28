-- Bid (spec 4.3/4.4): silent and live auction bid records.
-- No ON DELETE cascade on either FK: a Bid is a financial record (who owes
-- what, who won what — spec 4.8), so a PlayerEntry or User that already has
-- bids against them should block deletion (Postgres's default NO ACTION)
-- rather than silently destroying auction history.
create type bid_phase as enum ('silent', 'live');

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.player_entries (id),
  bidder_id uuid not null references public.users (id),
  amount numeric(10, 2) not null,
  phase bid_phase not null,
  placed_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);

create index bids_entry_id_idx on public.bids (entry_id);
create index bids_bidder_id_idx on public.bids (bidder_id);

alter table public.bids enable row level security;

grant select, insert, update, delete on public.bids to authenticated;
grant select, insert, update, delete on public.bids to service_role;

alter publication supabase_realtime add table public.bids;

-- Reads: Participants see bids only within tournaments they can see at all
-- (kind='production'); Admin/Owner see every bid in every tournament. This
-- is deliberately NOT scoped to "tournaments this Participant is rostered
-- in" — spec 4.3 requires every connected client to see updated high bids
-- in near-real-time, which means seeing bid activity on entries you aren't
-- bidding on too, not just your own bid history.
--
-- No insert/update/delete policy is added here, or ever will be: every bid
-- goes through the place-bid Edge Function via the service-role client,
-- which bypasses RLS entirely and validates against current state before
-- writing — something RLS can't safely express on its own.
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

-- player_entries.winning_bid_id lands here rather than in the
-- player_entries migration: player_entries.winning_bid_id -> bids.id and
-- bids.entry_id -> player_entries.id is a genuine circular dependency, so
-- one of the two tables' FK has to be added after the other table exists.
-- on delete set null (not cascade), matching this schema's established
-- financial-record pattern (Bid.entry_id, LiveLot.entry_id) — an entry's
-- sale record shouldn't silently disappear because the winning bid row was
-- removed.
alter table public.player_entries
  add column winning_bid_id uuid references public.bids (id) on delete set null;

create index player_entries_winning_bid_id_idx on public.player_entries (winning_bid_id);
