-- PlayerEntry (spec section 5, Phase 11): the atomic sellable/biddable
-- auction unit — one row per independently-biddable division. Bid,
-- LiveLot, and Payout all reference this table's id (entry_id), never a
-- Player directly. For an ordinary (non-Championship-flight) competitor
-- this is 1:1 with their Player row, so the distinction is invisible day to
-- day; a Championship-flight golfer has two (division 'gross' and 'net'),
-- each independently open/reserved/sold with its own bids, buyer, and
-- placement. See create_players.sql's own header for the fuller history of
-- why this split exists.
--
-- tournament_id/flight are denormalized from players (not just reachable
-- via player_id) so the placement-uniqueness index and RLS policies below
-- can stay real Postgres unique indexes/direct column checks rather than
-- needing to reach through a join to another table's columns for every
-- check — a unique index can't span a join. tournament_id never changes
-- post-creation; flight can (the admin edit form allows it), so
-- players_sync_entries_flight further down keeps every entry's
-- denormalized flight in step with its player's.
--
-- winning_bid_id is added by the bids migration (player_entries -> bids ->
-- player_entries is a genuine circular dependency, so one of the two
-- tables' FK has to be added after the other table exists — same reasoning
-- players.winning_bid_id used to follow before this column lived here).
create type player_status as enum ('open', 'reserved', 'sold_silent', 'sold_live', 'no_bid');

create table public.player_entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  flight text not null default '',
  -- Distinguishes a Championship-flight golfer's Gross entry from their Net
  -- entry; 'overall' for every entry in every other flight. Not nullable
  -- for the same NULL-in-unique-index reason as `flight`.
  division text not null default 'overall' check (division in ('overall', 'gross', 'net')),
  status public.player_status not null default 'open',
  placement integer check (placement > 0),
  buyer_marked_paid_at timestamptz,
  buyer_marked_paid_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Disallows placement ties within a flight/division (an Admin resolves a
-- tie some other way, e.g. a scorecard playoff, before entering results,
-- rather than the app splitting a placement's pot share across multiple
-- entries). Every ordinary flight has division='overall' for every entry,
-- so this degrades to plain per-flight uniqueness; the Championship
-- flight's Gross and Net entries rank independently of each other.
-- `placement` stays nullable and any number of not-yet-placed entries
-- coexist fine (NULL is distinct from every other NULL in a unique index).
create unique index player_entries_tournament_id_placement_key
  on public.player_entries (tournament_id, flight, division, placement);

create index player_entries_player_id_idx on public.player_entries (player_id);
create index player_entries_buyer_marked_paid_by_idx on public.player_entries (buyer_marked_paid_by);

alter table public.player_entries enable row level security;

grant select, insert, update, delete on public.player_entries to authenticated;
grant select, insert, update, delete on public.player_entries to service_role;

alter publication supabase_realtime add table public.player_entries;

-- Reads: Participants see entries only within tournaments they can see at
-- all (kind='production'); Admin/Owner see every entry in every tournament.
create policy "player_entries_select_participant_plus" on public.player_entries
for select to authenticated
using (
  public.current_user_role() in ('admin', 'owner')
  or (
    public.current_user_role() = 'participant'
    and exists (
      select 1 from public.tournaments t
      where t.id = player_entries.tournament_id and t.kind = 'production'
    )
  )
);

-- Writes: manual add/edit/remove is Admin/Owner only, same reasoning as
-- players. CSV import goes through a service-role Edge Function instead,
-- which bypasses RLS entirely.
create policy "player_entries_insert_admin_owner" on public.player_entries
for insert to authenticated
with check (public.current_user_role() in ('admin', 'owner'));

create policy "player_entries_update_admin_owner" on public.player_entries
for update to authenticated
using (public.current_user_role() in ('admin', 'owner'))
with check (public.current_user_role() in ('admin', 'owner'));

create policy "player_entries_delete_admin_owner" on public.player_entries
for delete to authenticated
using (public.current_user_role() in ('admin', 'owner'));

-- Division-vs-championship_flight validation, using the flight-membership
-- helper players.validate_flight_membership() already defines (shared so
-- the flight-membership rule can't drift between the two tables).
create function public.validate_entry_flight_division()
returns trigger
language plpgsql
as $$
declare
  v_championship_flight text;
begin
  perform public.validate_flight_membership(NEW.tournament_id, NEW.flight);

  select championship_flight into v_championship_flight
  from public.tournaments
  where id = NEW.tournament_id;

  if v_championship_flight is not null and NEW.flight = v_championship_flight then
    if NEW.division not in ('gross', 'net') then
      raise exception
        'Entries in the Championship flight ("%") must have a division of ''gross'' or ''net'', not ''%''.',
        v_championship_flight, NEW.division;
    end if;
  else
    if NEW.division != 'overall' then
      raise exception
        'Division ''%'' is only valid for an entry in the Championship flight; this entry''s flight is "%".',
        NEW.division, NEW.flight;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger player_entries_validate_flight_division
before insert or update of flight, division, tournament_id on public.player_entries
for each row
execute function public.validate_entry_flight_division();

-- Keeps every entry's denormalized flight/tournament_id in step with its
-- player's own — confirmed the admin edit form does allow changing a
-- player's flight after creation (tournament_id reassignment has no actual
-- UI path today, same "currently theoretical" status players_validate_flight
-- already calls out, but synced here too for the same reason). Runs after
-- players' own before-trigger has already validated the new flight, and
-- feeds straight into player_entries' own before-trigger re-validating it
-- there (redundant for flight-membership, necessary for division
-- re-derivation) — both checks stay correct with no special-casing needed.
create function public.sync_player_entries_flight()
returns trigger
language plpgsql
as $$
begin
  update public.player_entries
  set flight = NEW.flight, tournament_id = NEW.tournament_id
  where player_id = NEW.id;
  return NEW;
end;
$$;

create trigger players_sync_entries_flight
after update of flight, tournament_id on public.players
for each row
execute function public.sync_player_entries_flight();
