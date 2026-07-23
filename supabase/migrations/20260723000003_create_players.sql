-- Player (spec section 5): a tournament's competitor field.
-- user_id links a competitor to an app User — nullable, since not every
-- competitor uses the app and not every User is necessarily a Player (spec
-- 4.9). This link is not just a display indicator: per tournament, it's the
-- entire definition of who's allowed to bid (spec 4.9), enforced by
-- place-bid, not by this migration.
create type player_status as enum ('open', 'reserved', 'sold_silent', 'sold_live', 'no_bid');

create table public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  -- Unique-per-tournament alternate key, same default-'' /
  -- trigger-generated-if-omitted pattern as tournaments.slug.
  slug text not null default '',
  first_name text not null,
  last_name text not null,
  contact_email text,
  contact_phone text,
  preferences text,
  photo_url text,
  -- '' means "no flight assigned" — not null, since the per-flight
  -- placement uniqueness index below needs a comparable value (Postgres
  -- unique indexes treat NULL as distinct from every other NULL, which
  -- would silently defeat that uniqueness for any player with no flight).
  flight text not null default '',
  -- Distinguishes a Championship-flight player's Gross entry from their Net
  -- entry (each independently biddable); 'overall' for every player in
  -- every other flight. Not nullable for the same NULL-in-unique-index
  -- reason as `flight`.
  division text not null default 'overall' check (division in ('overall', 'gross', 'net')),
  status player_status not null default 'open',
  user_id uuid references public.users (id) on delete set null,
  handicap_index numeric(4, 1),
  -- No uniqueness constraint on its own — ties are disallowed at the index
  -- level below instead, scoped per flight/division.
  placement integer check (placement > 0),
  buyer_marked_paid_at timestamptz,
  buyer_marked_paid_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tournament_id, slug),
  -- A User can be linked to at most one Player per tournament per division
  -- (spec 5) — NULLs don't conflict with each other, so unlinked players
  -- are unrestricted. For every ordinary (non-Championship) player this is
  -- exactly "one player per tournament" (division is always 'overall');
  -- for a Championship-flight golfer it permits linking the same account
  -- to both their 'gross' and 'net' rows.
  unique (tournament_id, user_id, division)
  -- winning_bid_id is added by the bids migration (players -> bids ->
  -- players is a circular FK; bids.player_id needs this table to exist
  -- first, so this table's own reference to bids can't be declared here).
);

-- Disallows placement ties within a flight/division (an Admin resolves a
-- tie some other way, e.g. a scorecard playoff, before entering results,
-- rather than the app splitting a placement's pot share across multiple
-- players). Every ordinary flight has division='overall' for every player,
-- so this degrades to plain per-flight uniqueness; the Championship
-- flight's Gross and Net entries rank independently of each other.
-- `placement` stays nullable and any number of not-yet-placed players
-- coexist fine (NULL is distinct from every other NULL in a unique index).
create unique index players_tournament_id_placement_key
  on public.players (tournament_id, flight, division, placement);

create index players_buyer_marked_paid_by_idx on public.players (buyer_marked_paid_by);

alter table public.players enable row level security;

grant select, insert, update, delete on public.players to authenticated;
grant select, insert, update, delete on public.players to service_role;

alter publication supabase_realtime add table public.players;

-- Auto-generates a unique-per-tournament slug from first/last name on
-- insert when one isn't supplied, same pattern as tournaments_set_slug
-- (reuses the shared public.slugify() helper). Insert-only, not update — a
-- slug is edited explicitly afterward, not silently regenerated when the
-- name changes.
create function public.players_set_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_slug text;
  candidate text;
  suffix int := 1;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;

  base_slug := public.slugify(new.first_name || ' ' || new.last_name);
  candidate := base_slug;

  while exists (
    select 1 from public.players
    where tournament_id = new.tournament_id and slug = candidate
  ) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger players_set_slug_trigger
  before insert on public.players
  for each row execute function public.players_set_slug();

-- Enforces two invariants a plain check constraint can't express, since
-- both need to compare a players row against its *owning tournament's*
-- configuration:
--   1. flight (when set) must be one of the owning tournament's configured
--      flights — '' ("no flight assigned") is always allowed.
--   2. division must be 'gross' or 'net' if and only if
--      flight = championship_flight; every other flight (including '')
--      must be 'overall'.
-- Plain SECURITY INVOKER (the default) — both write paths that reach this
-- trigger already have their own read access to tournaments: the player
-- new/edit forms run as the caller's own authenticated (Admin/Owner)
-- session; import-csv-confirm writes via its service-role client, which
-- bypasses RLS entirely.
create function public.validate_player_flight_division()
returns trigger
language plpgsql
as $$
declare
  v_flights text[];
  v_championship_flight text;
begin
  select flights, championship_flight
    into v_flights, v_championship_flight
  from public.tournaments
  where id = NEW.tournament_id;

  if NEW.flight != '' and not (NEW.flight = any (v_flights)) then
    raise exception
      'Flight "%" is not configured for this tournament. Add it to the tournament''s flights list first.',
      NEW.flight;
  end if;

  if v_championship_flight is not null and NEW.flight = v_championship_flight then
    if NEW.division not in ('gross', 'net') then
      raise exception
        'Players in the Championship flight ("%") must have a division of ''gross'' or ''net'', not ''%''.',
        v_championship_flight, NEW.division;
    end if;
  else
    if NEW.division != 'overall' then
      raise exception
        'Division ''%'' is only valid for a player in the Championship flight; this player''s flight is "%".',
        NEW.division, NEW.flight;
    end if;
  end if;

  return NEW;
end;
$$;

-- Column-scoped on UPDATE (not on every column) — a player row gets updated
-- for plenty of reasons unrelated to flight/division (placement, paid
-- status, bid linkage), and re-validating a stale flight/division
-- combination on every unrelated write would incorrectly block those
-- writes for any tournament that hasn't configured `flights` yet.
-- Re-validates on tournament_id too for the (currently theoretical) case of
-- a player ever being reassigned to a different tournament.
create trigger players_validate_flight_division
before insert or update of flight, division, tournament_id on public.players
for each row
execute function public.validate_player_flight_division();

-- Reads: Participants see players only within tournaments they can see at
-- all (kind='production'); Admin/Owner see every player in every
-- tournament.
create policy "players_select_participant_plus" on public.players
for select to authenticated
using (
  public.current_user_role() in ('admin', 'owner')
  or (
    public.current_user_role() = 'participant'
    and exists (
      select 1 from public.tournaments t
      where t.id = players.tournament_id and t.kind = 'production'
    )
  )
);

-- Writes: manual add/edit/remove is Admin/Owner only, same "basic form
-- validation doesn't need an Edge Function" reasoning as Tournament
-- settings. CSV import goes through a service-role Edge Function instead,
-- which bypasses RLS entirely.
create policy "players_insert_admin_owner" on public.players
for insert to authenticated
with check (public.current_user_role() in ('admin', 'owner'));

create policy "players_update_admin_owner" on public.players
for update to authenticated
using (public.current_user_role() in ('admin', 'owner'))
with check (public.current_user_role() in ('admin', 'owner'));

create policy "players_delete_admin_owner" on public.players
for delete to authenticated
using (public.current_user_role() in ('admin', 'owner'));
