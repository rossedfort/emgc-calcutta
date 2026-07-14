-- Phase 2: Player entries for a tournament's competitor field.
-- Player.user_id links a competitor to an app User — nullable, since not
-- every competitor uses the app and not every User is necessarily a Player
-- (spec 4.9). This link is not just a display indicator: per tournament,
-- it's the entire definition of who's allowed to bid (spec 4.9), enforced
-- later by place-bid (Phase 3), not by this migration.
create type player_status as enum ('open', 'reserved', 'sold_silent', 'sold_live', 'no_bid');

create table public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  slug text not null,
  name text not null,
  contact_email text,
  contact_phone text,
  preferences text,
  photo_url text,
  flight text,
  status player_status not null default 'open',
  user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tournament_id, slug),
  -- A User can be linked to at most one Player per tournament (spec 5) — NULLs
  -- don't conflict with each other, so unlinked players are unrestricted.
  unique (tournament_id, user_id)
);

alter table public.players enable row level security;

grant select, insert, update, delete on public.players to authenticated;
grant select, insert, update, delete on public.players to service_role;

-- Auto-generates a unique-per-tournament slug from `name` on insert when one
-- isn't supplied, same pattern as tournaments_set_slug (reuses the shared
-- public.slugify() helper). Insert-only, not update — a slug is edited
-- explicitly afterward, not silently regenerated when the name changes.
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

  base_slug := public.slugify(new.name);
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

-- Reads: Participants see players only within tournaments they can see at
-- all (kind='production' — dry runs are Admin/Owner-only, see the migration
-- just before this one); Admin/Owner see every player in every tournament.
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
-- validation doesn't need an Edge Function" reasoning as Tournament settings
-- (spec 6.5). CSV import (later Phase 2 tasks) goes through a service-role
-- Edge Function instead, which bypasses RLS entirely.
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
