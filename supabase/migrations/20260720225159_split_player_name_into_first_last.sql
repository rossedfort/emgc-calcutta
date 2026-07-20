-- Phase 8: split players.name into first_name/last_name. Pre-production —
-- no real deployed data to preserve, but the local/remote demo tournaments
-- do have real rows, so this backfills rather than dropping data outright.
-- Every existing player name is a clean "First Last" (verified directly,
-- no 1-word or 3+-word names in either demo tournament), so a first-space
-- split is lossless here — this is not a general-purpose name splitter.
alter table public.players add column first_name text;
alter table public.players add column last_name text;

update public.players
set
  first_name = split_part(name, ' ', 1),
  last_name = trim(substring(name from position(' ' in name) + 1));

alter table public.players alter column first_name set not null;
alter table public.players alter column last_name set not null;
alter table public.players drop column name;

-- players_set_slug() (create_players.sql) slugified `new.name` — same
-- function, same trigger, just repointed at the concatenated name.
create or replace function public.players_set_slug()
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
