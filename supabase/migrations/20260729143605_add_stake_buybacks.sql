-- Stake buy-back (Phase 14): lets a golfer whose stake was bought in the
-- auction negotiate buying back a percentage of it from the winning
-- bidder — e.g. Player A wins Player B's stake for $100, Player B buys
-- back 50% for $50, and if Player B then wins the tournament the payout
-- splits 50/50 between A and B. The app never processes the buy-back
-- payment itself (spec 2/4.8's "payment happens outside the app"
-- boundary, unchanged) — what it tracks is the *arrangement* (who
-- requested what, who agreed), which then changes the computed Payout
-- split once results are entered.

-- Nullable/unset = feature disabled for that tournament, same
-- "unconfigured" precedent as payout_structure defaulting to '{}'. Same
-- 0-1 fraction convention as payouts.pot_share.
alter table public.tournaments
  add column buy_back_percentage numeric(5, 4)
    check (buy_back_percentage > 0 and buy_back_percentage < 1);

-- The actual real-world golf tournament's start (tee times) — distinct
-- from silent_auction_start/silent_auction_end (the app's own auction
-- window) and from live_auction_started_at (when an Admin opened the
-- live auction event). Once this passes, the buy-back request button
-- stops being offered (checked by request-stake-buyback and the
-- request-stake-buyback UI, not by anything in this migration — a
-- passed event_start_at doesn't invalidate an already-accepted
-- arrangement, it only gates new requests).
alter table public.tournaments
  add column event_start_at timestamptz;

-- No RLS/grant changes needed for either new tournaments column:
-- tournaments_update_admin_owner already lets Admin/Owner update any
-- column (including these), matching payout_structure's own "Admin can
-- edit too" precedent from Phase 7.

-- At most one arrangement per sold entry (unique(entry_id)) — a
-- rejected request can be reconsidered by editing this same row back to
-- 'pending' rather than accumulating a new row per attempt, matching
-- this app's "nothing truly unrecoverable" pattern (void-bid,
-- link/unlink, Phase 12.5's reject/un-reject).
--
-- requester_id/buyer_id: the golfer (players.user_id at request time)
-- and the winning bidder (winning_bid.bidder_id at request time),
-- denormalized directly onto this row rather than joined through
-- player_entries/players/bids on every read — both RLS and the
-- request/respond Edge Functions need to check "is the caller the
-- requester" / "is the caller the buyer" cheaply and often.
--
-- percentage/amount are locked in from tournament.buy_back_percentage
-- and winning_bid.amount at request time, not live references — same
-- "lock in the computed value" precedent as payouts.pot_share/amount,
-- so a later tournament-setting edit can't retroactively change an
-- already-requested arrangement.
create table public.stake_buybacks (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  entry_id uuid not null references public.player_entries (id),
  requester_id uuid not null references public.users (id),
  buyer_id uuid not null references public.users (id),
  percentage numeric(5, 4) not null check (percentage > 0 and percentage < 1),
  amount numeric(10, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references public.users (id) on delete set null
);

create unique index stake_buybacks_entry_id_key on public.stake_buybacks (entry_id);
create index stake_buybacks_tournament_id_idx on public.stake_buybacks (tournament_id);
create index stake_buybacks_requester_id_idx on public.stake_buybacks (requester_id);
create index stake_buybacks_buyer_id_idx on public.stake_buybacks (buyer_id);
create index stake_buybacks_responded_by_idx on public.stake_buybacks (responded_by);

alter table public.stake_buybacks enable row level security;

-- Reads only: the requester and the buyer can each read their own
-- arrangement, Admin/Owner read every arrangement (feeds bookkeeping).
-- No write policy at all, deliberately — same posture as payouts:
-- request-stake-buyback (creates the row, needs to check the entry is
-- actually sold, before event_start_at, requester isn't the buyer, no
-- existing active request) and respond-stake-buyback (accept/reject,
-- needs to recompute the payout split on accept) are both validation-
-- heavy money-adjacent writes that go through service_role via an Edge
-- Function, not a direct RLS-permitted client write.
create policy "stake_buybacks_select_requester_buyer_or_admin_owner" on public.stake_buybacks
for select to authenticated
using (
  requester_id = auth.uid()
  or buyer_id = auth.uid()
  or public.current_user_role() in ('admin', 'owner')
);

grant select on public.stake_buybacks to authenticated;
grant select, insert, update, delete on public.stake_buybacks to service_role;

-- A split needs two payouts rows for one entry (the buyer's remaining
-- share and the golfer's bought-back share), so the previous "exactly
-- one payout per entry" constraint has to widen to "at most one payout
-- per (entry, recipient)".
drop index public.payouts_entry_id_key;
create unique index payouts_entry_id_bidder_id_key on public.payouts (entry_id, bidder_id);

-- Traces a split payout row back to the arrangement that produced it,
-- without repurposing what bidder_id means — it stays "who this
-- specific payout row is owed to," buyer or golfer alike. Null for
-- every ordinary (non-split) payout. on delete set null matches
-- marked_paid_by's own precedent on this same table: a payout is a
-- financial record that should outlive the row that explains its shape,
-- not disappear or block deletion because of it.
alter table public.payouts
  add column stake_buyback_id uuid references public.stake_buybacks (id) on delete set null;

create index payouts_stake_buyback_id_idx on public.payouts (stake_buyback_id);
