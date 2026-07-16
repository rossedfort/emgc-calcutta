-- Phase 7 foundation (spec 5's Player fields, the payout-adjacent ones
-- not already added in Phases 1-2): placement, winning_bid_id,
-- buyer_marked_paid_at, buyer_marked_paid_by.
--
-- winning_bid_id: on delete set null (not cascade), matching
-- live_lots.winning_bid_id's own precedent — the same "a financial/
-- historical record shouldn't silently disappear because the row it
-- points at was removed" reasoning already applied throughout this
-- schema (Bid.player_id, LiveLot.player_id). A basic positive-integer
-- check on placement is the only constraint added here — NOT a
-- uniqueness constraint on (tournament_id, placement), since whether
-- ties are even allowed is an explicit open question for the
-- set-placement task to resolve, not this one.
alter table public.players
  add column placement integer check (placement > 0),
  add column winning_bid_id uuid references public.bids (id) on delete set null,
  add column buyer_marked_paid_at timestamptz,
  add column buyer_marked_paid_by uuid references public.users (id) on delete set null;

create index players_winning_bid_id_idx on public.players (winning_bid_id);
create index players_buyer_marked_paid_by_idx on public.players (buyer_marked_paid_by);

-- close_silent_auctions() only ever set status before — for a
-- sold-silent player there's no live_lots row at all, so this cron job
-- is the *only* place their winning bid can ever be recorded. Computed
-- via a correlated scalar subquery in the SET clause (same "current
-- non-voided high bid" lookup place-bid/close_live_lot themselves
-- already use) — a LATERAL join in the FROM clause can't reference the
-- UPDATE's own target table (verified directly: Postgres rejects it with
-- "invalid reference to FROM-clause entry for table p"), but a
-- correlated subquery in SET can, so the whole sweep still stays one
-- statement, matching this function's existing plain-SQL (not plpgsql)
-- shape.
create or replace function public.close_silent_auctions()
returns void
language sql
as $$
  update public.players p
  set
    status = 'sold_silent',
    winning_bid_id = (
      select b.id
      from public.bids b
      where b.player_id = p.id and b.voided_at is null
      order by b.amount desc
      limit 1
    )
  from public.tournaments t
  where p.tournament_id = t.id
    and p.status = 'open'
    and t.silent_auction_end < now();
$$;

-- close_live_lot() already computed high_bid_id for live_lots.winning_bid_id
-- but never copied it onto players — the one line this adds.
create or replace function public.close_live_lot(lot_id uuid)
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

-- Backfill: any player already sold via either path before this column
-- existed gets winning_bid_id computed the same way, so pot calculation
-- (the whole reason this column exists) isn't silently wrong for
-- tournaments/players that predate it. no_bid players are correctly
-- excluded by the status filter — they have no winning bid by
-- definition, NULL is the right value, not something to backfill.
update public.players p
set winning_bid_id = (
  select b.id
  from public.bids b
  where b.player_id = p.id and b.voided_at is null
  order by b.amount desc
  limit 1
)
where p.status in ('sold_silent', 'sold_live')
  and p.winning_bid_id is null;
