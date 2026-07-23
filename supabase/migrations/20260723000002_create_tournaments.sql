-- Tournament (spec section 5). A single internal league runs any number of
-- tournaments (multi-tournament support, spec section 2) so these settings
-- live directly here rather than on a separate League/membership table.
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- URL-friendly alternate key (e.g. "emgc-cc-2026") used in place of the
  -- raw UUID in routes — FKs continue to reference tournaments.id, never
  -- the slug. Default '' rather than no default: the insert trigger below
  -- fills in a real value whenever the incoming value is null or '', which
  -- makes omitting slug on insert valid at runtime but `supabase gen types
  -- typescript` only looks at column defaults (not trigger behavior) to
  -- decide whether an Insert field is optional.
  slug text not null unique default '',
  silent_auction_start timestamptz not null,
  silent_auction_end timestamptz not null,
  -- Coarse lifecycle state for admin UI/display purposes. This is
  -- deliberately not the authoritative gate for silent/live auction phase
  -- logic (spec 6.5 ties silent-auction close to silent_auction_end, and
  -- lot-level state lives on LiveLot).
  status text not null default 'setup' check (status in ('setup', 'active', 'complete')),
  -- Distinguishes real tournaments from Admin-run rehearsals so dry runs are
  -- visually distinguishable in the admin list and can be excluded from
  -- historical views later without deleting their data (spec sections 2, 5).
  kind text not null default 'production' check (kind in ('production', 'dry_run')),
  threshold_amount numeric(10, 2) not null,
  min_increment numeric(10, 2) not null,
  -- 15s is the example anti-snipe window from spec section 4.4; <= 0 means
  -- anti-snipe is disabled ("can be disabled if a human auctioneer is
  -- calling it live").
  anti_snipe_seconds integer not null default 15,
  -- e.g. {"1": 0.5, "2": 0.3, "3": 0.2} — percentage of the pot per finishing place.
  payout_structure jsonb not null default '{}'::jsonb,
  -- Set exactly once, by start_live_auction() below, and never cleared —
  -- there's no "pause"/"stop" concept, matching how silent_auction_end
  -- itself is a one-way gate. Silent and live auction phases never run
  -- concurrently: the live auction is a deliberate, manually-started event
  -- that can only begin once the silent auction has already ended.
  live_auction_started_at timestamptz,
  -- Source of truth for a tournament's flight names and their display
  -- order — players.flight (free text) is expected to be displayed/sorted
  -- in this order wherever it appears, not alphabetically.
  flights text[] not null default '{}'::text[],
  -- Optionally designates one of `flights` as the flight whose players get
  -- auctioned twice, once for Gross and once for Net (spec gap, confirmed
  -- money-math decisions: per-flight/division pot scoping, shared
  -- payout_structure across Gross/Net).
  championship_flight text,
  created_at timestamptz not null default now(),
  constraint tournaments_championship_flight_in_flights
    check (championship_flight is null or championship_flight = any (flights))
);

alter table public.tournaments enable row level security;

grant select, insert, update, delete on public.tournaments to service_role;
grant select, insert, update on public.tournaments to authenticated;

-- Participants only see kind='production' tournaments (dry runs are an
-- Admin/Owner-only rehearsal concept); Admin/Owner see every tournament
-- regardless of kind.
create policy "tournaments_select_participant_plus" on public.tournaments
for select to authenticated
using (
  (public.current_user_role() = 'participant' and kind = 'production')
  or public.current_user_role() in ('admin', 'owner')
);

-- Admin/Owner can create and edit settings (spec 4.3: the auction
-- window/threshold/increment are "settable by Admin/Owner"). No DELETE
-- policy — deleting a tournament isn't a feature the spec calls for
-- anywhere, and it's too destructive to leave client-reachable by default;
-- only service-role can.
create policy "tournaments_insert_admin_owner" on public.tournaments
for insert
to authenticated
with check (public.current_user_role() in ('admin', 'owner'));

create policy "tournaments_update_admin_owner" on public.tournaments
for update
to authenticated
using (public.current_user_role() in ('admin', 'owner'))
with check (public.current_user_role() in ('admin', 'owner'));

-- Shared by every slugified table (tournaments, players): lowercases,
-- replaces runs of non-alphanumerics with a single '-', trims leading/
-- trailing '-'.
create function public.slugify(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(input), '[^a-z0-9]+', '-', 'g'));
$$;

-- Auto-generates a unique slug from `name` on insert when one isn't
-- supplied — de-duplicates with a numeric suffix (e.g. "-2") if the base
-- slug is already taken (two tournaments sharing a name, most likely).
-- Deliberately BEFORE INSERT only, not UPDATE: once set, a slug is edited
-- explicitly like any other setting, not silently regenerated whenever the
-- name changes (that would break existing links). SECURITY DEFINER + empty
-- search_path so the uniqueness check sees every row regardless of the
-- calling user's RLS-visible set, matching current_user_role()'s pattern.
create function public.tournaments_set_slug()
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

  base_slug := public.slugify(new.name);
  candidate := base_slug;

  while exists (select 1 from public.tournaments where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger tournaments_set_slug_trigger
  before insert on public.tournaments
  for each row execute function public.tournaments_set_slug();

-- Starts the live auction exactly once, after the silent auction has ended.
-- Plain SECURITY INVOKER (the default) — the existing
-- tournaments_update_admin_owner policy already lets Admin/Owner update this
-- column directly, so this function grants no more authority than the
-- caller already has; it just adds the two guards a plain client-side
-- .update() can't express safely on its own (can't start early, can't start
-- twice).
create function public.start_live_auction(tournament_id uuid)
returns void
language plpgsql
as $$
declare
  silent_end timestamptz;
  already_started timestamptz;
begin
  select silent_auction_end, live_auction_started_at
    into silent_end, already_started
  from public.tournaments
  where id = tournament_id;

  if silent_end is null then
    raise exception 'Tournament not found';
  end if;

  if already_started is not null then
    raise exception 'The live auction has already been started';
  end if;

  if silent_end > now() then
    raise exception 'The silent auction hasn''t ended yet';
  end if;

  update public.tournaments
  set live_auction_started_at = now()
  where id = tournament_id;

  -- An RLS-blocked UPDATE affects zero rows rather than raising an error on
  -- its own — FOUND is set by the UPDATE above, so this turns a silent
  -- no-op into an explicit error instead of a misleading "it worked."
  if not found then
    raise exception 'Not permitted to start the live auction for this tournament';
  end if;
end;
$$;

grant execute on function public.start_live_auction(uuid) to authenticated;
