-- Bugfix (Phase 9 backlog): close_silent_auctions() unconditionally marked
-- every still-`open` player `sold_silent` once the silent window closed,
-- regardless of whether they ever received a bid -- winning_bid_id already
-- correctly computed null for a never-bid player, but status was set to
-- `sold_silent` anyway, making `no_bid` unreachable via the silent phase.
-- close_live_lot() already gets this right for the live phase (a surviving
-- non-voided bid means sold, none means no_bid) -- this brings the silent
-- cron sweep in line with that same, already-established rule.
-- A plain correlated scalar subquery in SET (not a LATERAL join in FROM --
-- Postgres rejects a FROM-clause LATERAL referencing the UPDATE target
-- table itself, confirmed directly) -- duplicated once for the status CASE
-- and once for winning_bid_id, same shape the original function already
-- used for the latter. This table's per-tournament row count is small
-- enough that running the lookup twice per row is a non-issue for a
-- per-minute cron sweep.
create or replace function public.close_silent_auctions()
returns void
language sql
as $$
  update public.players p
  set
    status = case
      when (
        select b.id from public.bids b
        where b.player_id = p.id and b.voided_at is null
        order by b.amount desc limit 1
      ) is not null then 'sold_silent'::public.player_status
      else 'no_bid'::public.player_status
    end,
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
