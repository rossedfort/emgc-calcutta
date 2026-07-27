-- Silent auction auto-close (spec 4.3, 182): once a tournament's
-- silent_auction_end passes, any player who never crossed the reserve
-- threshold (still status = 'open') is marked "sold_silent" to the current
-- high bidder. Players that got reserved along the way are left alone —
-- they roll into the live auction instead, per spec.
--
-- Runs as a pg_cron job rather than a Node interval process, per spec 182.
-- The scheduled job runs as its creator (postgres), which owns every table
-- here and so bypasses RLS entirely; unlike the Edge Functions in this
-- project, no explicit grant to service_role is needed for this to work.
create extension if not exists pg_cron;

create function public.close_silent_auctions()
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

select cron.schedule(
  'close-silent-auctions',
  '* * * * *',
  $$select public.close_silent_auctions();$$
);
