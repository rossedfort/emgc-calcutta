-- Player (spec section 5): a tournament competitor's identity — one row
-- per real person, full stop. user_id links a competitor to an app User —
-- nullable, since not every competitor uses the app and not every User is
-- necessarily a Player (spec 4.9). This link is not just a display
-- indicator: per tournament, it's the entire definition of who's allowed to
-- bid (spec 4.9), enforced by place-bid, not by this migration.
--
-- Squashed (Phase 10.7): originally also had contact_email/contact_phone
-- columns, dropped in a later migration once self-service linking (Phase
-- 10) gave every Player a way to get connected to a User without them —
-- folded back into this original migration rather than left as a
-- create-then-drop pair, matching this codebase's established squash
-- precedent. contact_email's only functional use was CSV import's
-- email-match auto-link, itself removed the same phase; contact_phone was
-- never read anywhere outside of storage/display.
--
-- Squashed again (Phase 11): originally also carried division, status,
-- winning_bid_id, placement, buyer_marked_paid_at, and buyer_marked_paid_by
-- directly — a single row can't represent "gross is sold, net is still
-- open" simultaneously, so a Championship-flight golfer used to be two
-- entirely independent Player rows (Phase 7.5) with no real FK between
-- them, and every "is this the same golfer" check (self-linking, admin
-- link/unlink, the self-link dropdown's dedup filter) had to fuzzy-match on
-- (tournament_id, flight, first_name, last_name) instead. Those six columns
-- moved to the new player_entries table (see create_player_entries.sql,
-- immediately after this migration) — the atomic sellable/biddable unit,
-- with a real player_id FK back here — leaving this table pure identity.
create table public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  -- Unique-per-tournament alternate key, same default-'' /
  -- trigger-generated-if-omitted pattern as tournaments.slug. One per
  -- golfer regardless of how many player_entries rows they have.
  slug text not null default '',
  first_name text not null,
  last_name text not null,
  preferences text,
  photo_url text,
  -- '' means "no flight assigned" — not null, since player_entries' own
  -- per-flight placement uniqueness index needs a comparable value
  -- (Postgres unique indexes treat NULL as distinct from every other NULL,
  -- which would silently defeat that uniqueness for any entry with no
  -- flight).
  flight text not null default '',
  user_id uuid references public.users (id) on delete set null,
  handicap_index numeric(4, 1),
  created_at timestamptz not null default now(),
  unique (tournament_id, slug),
  -- A User can be linked to at most one Player per tournament (spec 5) —
  -- NULLs don't conflict with each other, so unlinked players are
  -- unrestricted. Plain "one player per tournament," full stop: because the
  -- link lives here on identity rather than on the sellable-unit table, a
  -- Championship-flight golfer's linked account automatically covers both
  -- their gross and net entries the moment this one row is linked — no
  -- division-scoped relaxation needed, unlike the two-independent-rows
  -- shape this replaced.
  unique (tournament_id, user_id)
);

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

-- Flight-membership check, shared by both players and player_entries (see
-- create_player_entries.sql) so the rule can't drift between the two — a
-- player's flight matters regardless of how many entries it has, and an
-- entry's own denormalized flight is re-validated against the same rule
-- independently. Plain SECURITY INVOKER (the default) — both write paths
-- that reach this run as either the caller's own authenticated
-- (Admin/Owner) session or import-csv-confirm's service-role client, which
-- bypasses RLS entirely.
create function public.validate_flight_membership(p_tournament_id uuid, p_flight text)
returns void
language plpgsql
as $$
declare
  v_flights text[];
begin
  if p_flight = '' then
    return;
  end if;

  select flights into v_flights from public.tournaments where id = p_tournament_id;

  if not (p_flight = any (v_flights)) then
    raise exception
      'Flight "%" is not configured for this tournament. Add it to the tournament''s flights list first.',
      p_flight;
  end if;
end;
$$;

create function public.validate_player_flight()
returns trigger
language plpgsql
as $$
begin
  perform public.validate_flight_membership(NEW.tournament_id, NEW.flight);
  return NEW;
end;
$$;

-- Column-scoped on UPDATE (not on every column) — a player row gets updated
-- for plenty of reasons unrelated to flight (preferences, handicap, linked
-- user), and re-validating a stale flight on every unrelated write would
-- incorrectly block those writes for any tournament that hasn't configured
-- `flights` yet. Re-validates on tournament_id too for the (currently
-- theoretical) case of a player ever being reassigned to a different
-- tournament.
create trigger players_validate_flight
before insert or update of flight, tournament_id on public.players
for each row
execute function public.validate_player_flight();

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
