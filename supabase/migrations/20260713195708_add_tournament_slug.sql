-- Phase 1.6: multi-tournament support. `slug` is a URL-friendly alternate
-- key for tournaments (e.g. "emgc-cc-2026") used in place of the raw UUID
-- in routes — FKs continue to reference tournaments.id, never the slug.
-- No existing rows to backfill (table is empty), so this can be added
-- directly as `not null unique`.
alter table public.tournaments
  add column slug text not null unique;

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
-- name changes (that would break existing links). security definer +
-- empty search_path so the uniqueness check sees every row regardless of
-- the calling user's RLS-visible set, matching current_user_role()'s
-- pattern elsewhere in this schema.
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
