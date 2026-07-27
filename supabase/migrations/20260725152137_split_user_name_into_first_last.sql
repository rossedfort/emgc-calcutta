-- Splits public.users.name into first_name/last_name (spec 4.1's profile-
-- completion gate needs these as two separate fields, not a display blob),
-- mirroring the same split already done for players.first_name/last_name.
-- Deliberately nullable, unlike the players version (which backfilled then
-- made both columns not null): a User's profile is allowed to be
-- incomplete until the completion gate is satisfied, so the schema itself
-- has to be able to represent "not filled in yet," not just "filled in."
alter table public.users add column first_name text;
alter table public.users add column last_name text;

-- Best-effort backfill for any existing rows, same first-space-split
-- reasoning as the players migration — a real name-splitter this is not,
-- but every account created so far came from an OAuth provider's "First
-- Last" full name.
update public.users
set
  first_name = nullif(split_part(name, ' ', 1), ''),
  last_name = nullif(trim(substring(name from position(' ' in name) + 1)), '')
where name is not null and name != '';

alter table public.users drop column name;

-- Recreated in full since plpgsql function bodies can't be partially
-- altered — same best-effort split moves from a single `name` insert
-- column to first_name/last_name. Still a convenience default only: a
-- provider that returns a single-word name, no name at all, or a
-- multi-word surname that splits oddly all still land here with something
-- in first_name (possibly null last_name) rather than blocking sign-in —
-- the completion gate (root +layout.server.ts) is what actually catches
-- those cases and sends the user to /profile to confirm or correct it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  full_name text;
begin
  full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');

  insert into public.users (id, email, first_name, last_name, avatar_url, sso_provider)
  values (
    new.id,
    new.email,
    nullif(split_part(full_name, ' ', 1), ''),
    nullif(trim(substring(full_name from position(' ' in full_name) + 1)), ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    case new.raw_app_meta_data ->> 'provider'
      when 'google' then 'google'::public.auth_provider
      when 'azure' then 'azure'::public.auth_provider
      when 'email' then 'email'::public.auth_provider
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Lets a signed-in user correct their own first_name/last_name from
-- /profile (spec 4.1's completion gate) without a full self-service write
-- policy on the whole row — role changes and other fields still go through
-- service-role only, per users' existing "no INSERT/UPDATE/DELETE policy"
-- posture. Column-scoped at the grant level (not just the policy), so even
-- a crafted request naming other columns is rejected before RLS is
-- evaluated at all.
grant update (first_name, last_name) on public.users to authenticated;

create policy "users_update_self" on public.users
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());
