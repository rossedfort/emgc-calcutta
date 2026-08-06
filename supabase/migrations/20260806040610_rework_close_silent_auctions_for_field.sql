-- Phase 20: sweep zero-bid entries into a pooled "field" lot at silent
-- auction close, instead of dead-ending them at no_bid. Rewritten from a
-- single set-based UPDATE (language sql) to plpgsql, since "does a field
-- entry already exist for this group, reuse it or create one" is a
-- conditional, stateful decision a plain UPDATE can't express.
--
-- create or replace, not drop+create — the existing pg_cron job
-- references this function by name in its command text
-- ('select public.close_silent_auctions();'), not by OID, so it keeps
-- working unchanged with no need to re-schedule it.
create or replace function public.close_silent_auctions()
returns void
language plpgsql
as $$
declare
  open_group record;
  existing_field_entry_id uuid;
  new_field_player_id uuid;
begin
  -- Entries that received at least one real (non-voided) silent bid:
  -- unchanged from the original implementation.
  update public.player_entries e
  set
    status = 'sold_silent',
    winning_bid_id = (
      select b.id from public.bids b
      where b.entry_id = e.id and b.voided_at is null
      order by b.amount desc
      limit 1
    )
  from public.tournaments t
  where e.tournament_id = t.id
    and e.status = 'open'
    and t.silent_auction_end < now()
    and exists (
      select 1 from public.bids b
      where b.entry_id = e.id and b.voided_at is null
    );

  -- Entries that drew zero bids: pooled into one sellable field entry per
  -- (tournament, flight, division) group. One loop iteration per group
  -- that still has open, zero-bid entries past close — idempotent across
  -- cron ticks, since an entry already swept to 'field' no longer matches
  -- status = 'open' on a later run, and a group whose field entry already
  -- exists just gets new stragglers (e.g. a player manually added after
  -- close) pointed at the same one rather than a second lot being created.
  for open_group in
    select distinct e.tournament_id, e.flight, e.division
    from public.player_entries e
    join public.tournaments t on t.id = e.tournament_id
    where e.status = 'open'
      and t.silent_auction_end < now()
      and not exists (
        select 1 from public.bids b
        where b.entry_id = e.id and b.voided_at is null
      )
  loop
    -- Wrapped in its own exception block, not left to the outer
    -- transaction — the whole function body is otherwise one implicit
    -- transaction (this is invoked as a single statement from pg_cron), so
    -- without this, one group failing to sweep (e.g. a flight-membership
    -- violation on a tournament with a stale/misconfigured flights list)
    -- would roll back every other group's sweep *and* the plain sold_silent
    -- resolution above for every tournament being processed this tick, not
    -- just the one group at fault. Logged, not silently swallowed — same
    -- "don't block the rest of the system, but don't hide it either"
    -- posture this app already applies to notification-send failures.
    begin
      -- Serializes the existence-check-then-create below against a
      -- concurrent run for the exact same group — pg_cron doesn't
      -- guarantee non-overlapping ticks, and without this two overlapping
      -- runs could both see "no field entry yet" and each create one.
      -- Correctly released on the exception-block rollback below too, not
      -- just a clean exit (Postgres releases a subtransaction-acquired
      -- xact lock when that subtransaction aborts).
      perform pg_advisory_xact_lock(
        hashtext(open_group.tournament_id::text || open_group.flight || open_group.division)
      );

      select pe.id into existing_field_entry_id
      from public.player_entries pe
      join public.players p on p.id = pe.player_id
      where pe.tournament_id = open_group.tournament_id
        and pe.flight = open_group.flight
        and pe.division = open_group.division
        and p.is_field;

      if existing_field_entry_id is null then
        insert into public.players (tournament_id, first_name, last_name, flight, is_field)
        values (open_group.tournament_id, 'The', 'Field', open_group.flight, true)
        returning id into new_field_player_id;

        insert into public.player_entries (player_id, tournament_id, flight, division, status)
        values (
          new_field_player_id, open_group.tournament_id, open_group.flight, open_group.division, 'reserved'
        )
        returning id into existing_field_entry_id;

        perform public.enqueue_player_for_live_auction(
          open_group.tournament_id, existing_field_entry_id
        );
      end if;

      update public.player_entries e
      set status = 'field', field_entry_id = existing_field_entry_id
      from public.tournaments t
      where e.tournament_id = t.id
        and e.tournament_id = open_group.tournament_id
        and e.flight = open_group.flight
        and e.division = open_group.division
        and e.status = 'open'
        and t.silent_auction_end < now()
        and not exists (
          select 1 from public.bids b
          where b.entry_id = e.id and b.voided_at is null
        );
    exception when others then
      raise warning
        'close_silent_auctions: failed to sweep zero-bid group (tournament=%, flight=%, division=%): %',
        open_group.tournament_id, open_group.flight, open_group.division, sqlerrm;
    end;
  end loop;
end;
$$;
