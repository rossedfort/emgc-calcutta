-- User (spec section 5 data model, section 3 roles, section 4.1 first-login).

create type user_role as enum ('unassigned', 'participant', 'admin', 'owner');

-- Only the three SSO providers spec section 4.1 calls for.
create type auth_provider as enum ('google', 'azure', 'apple');

-- Extends auth.users with the app-specific profile fields the spec's User
-- model calls for (role, phone, avatar, etc).
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text not null,
  phone text,
  sso_provider auth_provider,
  avatar_url text,
  role user_role not null default 'unassigned',
  created_at timestamptz not null default now()
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

-- No INSERT/UPDATE/DELETE policy on users, deliberately: row creation is the
-- handle_new_user trigger below, and role changes are validated writes
-- (self-lockout prevention, Owner-only admin grants — see the update-
-- user-role Edge Function) that go through service-role, not a direct
-- RLS-permitted write (spec 6.5).

-- First-login flow (spec 4.1): every new Supabase Auth identity gets a
-- corresponding public.users profile row automatically, landing
-- "unassigned" (the column default above). Assigning a real role is a
-- separate concern (Role management UI), not this trigger's job — it only
-- ensures the row exists for an Admin to find and assign.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, name, avatar_url, sso_provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    case new.raw_app_meta_data ->> 'provider'
      when 'google' then 'google'::public.auth_provider
      when 'azure' then 'azure'::public.auth_provider
      when 'apple' then 'apple'::public.auth_provider
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
