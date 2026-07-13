-- First-login flow (spec section 4.1): every new Supabase Auth identity gets
-- a corresponding public.users profile row automatically, landing
-- "unassigned" (public.users.role already defaults to 'unassigned' — see
-- 20260710205122_create_users_and_tournaments.sql). Assigning a real role is
-- a separate, later backlog item ("Role management UI"); this only ensures
-- the row exists for an Admin to find and assign.
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

-- Backfill identities created before this trigger existed (e.g. during
-- Google/Azure OAuth testing earlier in Phase 1).
insert into public.users (id, email, name, avatar_url, sso_provider)
select
  au.id,
  au.email,
  coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'),
  coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture'),
  case au.raw_app_meta_data ->> 'provider'
    when 'google' then 'google'::public.auth_provider
    when 'azure' then 'azure'::public.auth_provider
    when 'apple' then 'apple'::public.auth_provider
    else null
  end
from auth.users au
on conflict (id) do nothing;
