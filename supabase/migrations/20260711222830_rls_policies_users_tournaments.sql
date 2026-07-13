-- RLS policies for public.users and public.tournaments (spec 6.5). Both
-- tables had RLS enabled with zero policies since their creation migration
-- (deliberately unreachable via the API until this task).

-- Resolves the caller's own role for use inside other tables' RLS policies
-- (e.g. "only admin/owner may read/write tournaments"). SECURITY DEFINER +
-- owned by `postgres` (which has BYPASSRLS) so this query doesn't itself
-- trigger the users SELECT policy below — avoids the classic "policy on a
-- table queries that same table" recursion footgun. See Supabase's RLS docs
-- for this pattern.
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

-- Tables created by migrations (running as `postgres`) don't inherit
-- SELECT/INSERT/UPDATE/DELETE for authenticated/anon by default on this
-- project — see the grant migration for service_role's equivalent gap
-- (.claude/CLAUDE.md Known quirks). RLS policies below decide which *rows*
-- are visible/writable; these GRANTs are the prerequisite for the
-- operation to be attempted at all.
grant select on public.users to authenticated;
grant select, insert, update on public.tournaments to authenticated;

-- users: every signed-in user can read their own row; Admin/Owner can read
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

-- No INSERT/UPDATE/DELETE policy on users, deliberately: row creation is
-- the handle_new_auth_user trigger, and role changes are validated writes
-- (self-lockout prevention, Owner-only admin grants — see the update-
-- user-role Edge Function) that go through service-role, not a direct
-- RLS-permitted write (spec 6.5).

-- tournaments: participant/admin/owner can read (unassigned users haven't
-- been let into the league yet — spec 4.1); Admin/Owner can create and
-- edit settings (spec 4.3 says the auction window/threshold/increment are
-- "settable by Admin/Owner"). No DELETE policy — deleting the league's
-- one tournament isn't a feature the spec calls for anywhere, and it's too
-- destructive to leave client-reachable by default; only service-role can.
create policy "tournaments_select_participant_plus" on public.tournaments
for select
to authenticated
using (public.current_user_role() in ('participant', 'admin', 'owner'));

create policy "tournaments_insert_admin_owner" on public.tournaments
for insert
to authenticated
with check (public.current_user_role() in ('admin', 'owner'));

create policy "tournaments_update_admin_owner" on public.tournaments
for update
to authenticated
using (public.current_user_role() in ('admin', 'owner'))
with check (public.current_user_role() in ('admin', 'owner'));
