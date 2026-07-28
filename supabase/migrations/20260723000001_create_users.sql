-- User (spec section 5 data model, section 3 roles, section 4.1 first-login).

create type user_role as enum ('unassigned', 'participant', 'admin', 'owner');

-- Google and Microsoft SSO (spec section 4.1), plus 'email' for passwordless
-- magic-link/OTP sign-in — a fourth, non-OAuth entry point for anyone
-- without a Google or Microsoft account. Still no passwords either way.
create type auth_provider as enum ('google', 'azure', 'email');

-- Extends auth.users with the app-specific profile fields the spec's User
-- model calls for (role, phone, avatar, etc).
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Nullable: OAuth/passwordless sign-in only ever hands back a single name
  -- blob (raw_user_meta_data), split on a best-effort basis by
  -- handle_new_user() below — not guaranteed for every provider/name shape
  -- (single-word names, missing name entirely, an oddly-splitting surname).
  -- A profile is allowed to be incomplete until the profile-completion gate
  -- (root +layout.server.ts) is satisfied, so the schema has to be able to
  -- represent "not filled in yet," not just "filled in."
  first_name text,
  last_name text,
  email text not null,
  phone text,
  sso_provider auth_provider,
  avatar_url text,
  role user_role not null default 'unassigned',
  created_at timestamptz not null default now(),
  -- Separate from "has a name": OAuth sign-in usually populates first_name/
  -- last_name via handle_new_user()'s best-effort split, but that's a guess
  -- the user never actually reviewed. The onboarding gate (root
  -- +layout.server.ts) checks this instead of first_name/last_name being
  -- non-null, so the profile step always shows at least once regardless of
  -- where the name came from — only set once a real updateProfile submit
  -- succeeds (which itself requires both names to be non-empty), so this is
  -- a strict superset of "profile complete."
  name_confirmed_at timestamptz
);

alter table public.users enable row level security;

-- Tables created by migrations (running as `postgres`) don't inherit
-- SELECT/INSERT/UPDATE/DELETE for authenticated/service_role by default on
-- this project (see .claude/CLAUDE.md Known quirks) — these grants are the
-- prerequisite for the operation to be attempted at all; RLS policies below
-- decide which *rows* are visible/writable on top of that.
grant select, insert, update, delete on public.users to service_role;
grant select on public.users to authenticated;

-- Resolves the caller's own role for use inside every other table's RLS
-- policies (e.g. "only admin/owner may read/write tournaments"). SECURITY
-- DEFINER + owned by `postgres` (which has BYPASSRLS) so this query doesn't
-- itself trigger the users SELECT policy below — avoids the classic "policy
-- on a table queries that same table" recursion footgun.
create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.users where id = auth.uid();
$$;

grant execute on function public.current_user_role() to authenticated, anon;

-- Every signed-in user can read their own row; Admin/Owner can read
-- everyone's (needed for any future direct-read UI beyond the existing
-- list-users Edge Function, which already works today via service-role
-- regardless of this policy).
create policy "users_select_self_or_admin" on public.users
for select
to authenticated
using (
  id = auth.uid()
  or public.current_user_role() in ('admin', 'owner')
);

-- No INSERT/DELETE policy on users, deliberately: row creation is the
-- handle_new_user trigger below, and role changes are validated writes
-- (self-lockout prevention, Owner-only admin grants — see the update-
-- user-role Edge Function) that go through service-role, not a direct
-- RLS-permitted write (spec 6.5).

-- Lets a signed-in user correct their own first_name/last_name from
-- /profile (spec 4.1's completion gate) without a full self-service write
-- policy on the whole row — role changes and other fields still go through
-- service-role only. Column-scoped at the grant level (not just the
-- policy), so even a crafted request naming other columns is rejected
-- before RLS is evaluated at all. name_confirmed_at included since
-- updateProfile stamps it in the same write as first_name/last_name.
grant update (first_name, last_name, name_confirmed_at) on public.users to authenticated;

create policy "users_update_self" on public.users
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- First-login flow (spec 4.1): every new Supabase Auth identity gets a
-- corresponding public.users profile row automatically, landing
-- "unassigned" (the column default above). Assigning a real role is a
-- separate concern (Role management UI), not this trigger's job — it only
-- ensures the row exists for an Admin to find and assign. first_name/
-- last_name are a best-effort split of the provider's single name blob
-- (first-space split) — a real name-splitter this is not, but every
-- account created so far came from an OAuth provider's "First Last" full
-- name; the profile-completion gate is what actually catches the cases
-- this split gets wrong (single-word names, no name at all, an oddly-
-- splitting surname) and sends the user to /profile to confirm/correct it.
create function public.handle_new_user()
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
