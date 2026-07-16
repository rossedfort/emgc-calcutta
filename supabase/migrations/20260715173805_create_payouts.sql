-- Phase 7: Payout (spec 5/4.8). One row per placed player, created by the
-- (later) set-placement Edge Function from Tournament.payoutStructure and
-- the total pot (sum of all winning bid amounts across the tournament).
-- markedPaidAt/markedPaidBy never trigger real payment — same "record-
-- keeping flag, not payment processing" pattern as
-- players.buyer_marked_paid_at/by (spec 2, Non-Goals).
--
-- player_id/bidder_id: no cascade, matching this schema's established
-- financial-record pattern (Bid.player_id, LiveLot.player_id) — a Payout
-- is a financial record, so a Player/User with payout history should
-- block deletion rather than silently lose it. tournament_id cascades,
-- matching every other tournament-scoped table.
--
-- unique(player_id): spec 4.9/134 says "one row per placed player" — a
-- placement correction recalculates and re-logs the existing row (via
-- upsert on this constraint) rather than accumulating stale duplicates.
-- Whether placement ties are even allowed, and how a tie would split
-- pot_share, is an explicit open question for the set-placement task
-- itself to resolve — not a constraint this schema task should guess at.
--
-- pot_share numeric(5,4): the placement's payout_structure percentage
-- (0-1 range, e.g. 0.5 for 50%) at the time this row was calculated —
-- kept alongside the derived dollar amount so a later payout_structure
-- edit can't retroactively change what an already-calculated Payout
-- looked like. amount numeric(10,2) matches bids.amount's own money
-- precision.
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.players (id),
  bidder_id uuid not null references public.users (id),
  placement integer not null check (placement > 0),
  pot_share numeric(5, 4) not null check (pot_share > 0 and pot_share <= 1),
  amount numeric(10, 2) not null,
  calculated_at timestamptz not null default now(),
  marked_paid_at timestamptz,
  marked_paid_by uuid references public.users (id) on delete set null
);

create unique index payouts_player_id_key on public.payouts (player_id);
create index payouts_tournament_id_idx on public.payouts (tournament_id);
create index payouts_bidder_id_idx on public.payouts (bidder_id);
create index payouts_marked_paid_by_idx on public.payouts (marked_paid_by);

alter table public.payouts enable row level security;

-- Reads only: self-read for the linked bidder_id (feeds the "My balance"
-- page) plus Admin/Owner read-all (feeds the bookkeeping dashboard) —
-- same "self or role" shape as users_select_self_or_admin, just matched
-- against bidder_id instead of id.
--
-- No write policy at all, deliberately, matching audit_events' own
-- posture: both set-placement (creates/recalculates rows) and
-- mark-payout-paid (sets marked_paid_at/by) are spec'd as Edge Functions
-- because they're validation/computation-heavy (pot math, placement
-- correction, payment confirmation), not a plain state toggle a client
-- should be able to write directly via RLS. Unlike live_lots (which does
-- get a plain-RLS write policy later for simple Admin state changes),
-- nothing about Payout is ever meant to be a direct client write.
create policy "payouts_select_self_or_admin_owner" on public.payouts
for select to authenticated
using (
  bidder_id = auth.uid()
  or public.current_user_role() in ('admin', 'owner')
);

-- authenticated gets select-only, matching the no-write-policy decision
-- above at the grant level too — set-placement/mark-payout-paid write as
-- service_role, not as the calling Admin's own authenticated role.
grant select on public.payouts to authenticated;

-- service_role gets no implicit grants on a newly-created table on this
-- project (see .claude/CLAUDE.md Known quirks) — required for the future
-- set-placement/mark-payout-paid Edge Functions to write at all.
grant select, insert, update, delete on public.payouts to service_role;
