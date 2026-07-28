-- Notify every Admin/Owner when a new user signs up (Phase 12 — spec 4.1's
-- "unassigned until an Admin/Owner sets their role" leaves an Admin no
-- signal today short of periodically checking /admin/users). A sibling
-- trigger to handle_new_user()'s own on_auth_user_created
-- (create_users.sql), not folded into that function itself — keeps "create
-- the row" and "notify about it" as separate concerns, matching this
-- codebase's established pattern of never baking a notification directly
-- into the write it's reacting to (see notify_on_bid_insert() etc. in
-- notification_dispatch_triggers.sql). Fires on every new public.users row
-- unconditionally: the role default is always 'unassigned' and a User row
-- has no tournament/kind concept at all, so there's no dry_run-style
-- conditional skip needed the way the auction triggers have one.

-- Same reasoning as dispatch_notification_url/service_role_key in
-- notification_dispatch_triggers.sql: existence-checked so this migration
-- stays safely re-runnable against an environment that's already been
-- through it, and the real value is set separately per environment
-- (vault.update_secret() locally, the Management API/Dashboard SQL Editor
-- for the hosted project) — never committed as a literal here.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_account_event_url') then
    perform vault.create_secret(
      'unset',
      'notify_account_event_url',
      'Full URL of the notify-account-event Edge Function for this environment'
    );
  end if;
end;
$$;

-- Near-duplicate of call_dispatch_notification() (same file) rather than a
-- shared helper taking the target URL as a parameter: call_dispatch_notification
-- already shipped in a prior migration, and this project's migrations are
-- additive/never edited after merge (see .claude/CLAUDE.md) — reuses the
-- same service_role_key secret (the auth requirement is identical, only the
-- target URL differs) and the same fire-and-forget exception handling
-- (a bad Vault secret or net.http_post failure here must never roll back
-- the users insert this fires from).
create function public.call_notify_account_event(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_function_url text;
  v_service_key text;
begin
  begin
    select decrypted_secret into v_function_url
    from vault.decrypted_secrets where name = 'notify_account_event_url';

    select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'service_role_key';

    perform net.http_post(
      url := v_function_url,
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key,
        'apikey', v_service_key
      )
    );
  exception when others then
    raise warning 'call_notify_account_event failed (payload %): %', payload, sqlerrm;
  end;
end;
$$;

grant execute on function public.call_notify_account_event(jsonb) to authenticated, service_role;

-- Fans out to every admin/owner row, matching the existing "for v_bidder in
-- ... loop" pattern already used by notify_on_bid_insert()'s
-- reserved-threshold notification and notify_on_live_auction_starting().
-- subjectName is a best-effort join of first_name/last_name (nullif'd to
-- NULL rather than an empty string) since a fresh signup may not have
-- either yet — notify-account-event falls back to the email address itself
-- when this comes through null.
create function public.notify_admins_of_new_signup()
returns trigger
language plpgsql
as $$
declare
  v_admin record;
  v_subject_name text;
begin
  v_subject_name := nullif(
    trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')),
    ''
  );

  for v_admin in
    select id from public.users where role in ('admin', 'owner')
  loop
    perform public.call_notify_account_event(jsonb_build_object(
      'userId', v_admin.id,
      'trigger', 'new_signup',
      'subjectName', v_subject_name,
      'subjectEmail', NEW.email
    ));
  end loop;
  return NEW;
end;
$$;

create trigger users_notify_admins_of_new_signup
after insert on public.users
for each row execute function public.notify_admins_of_new_signup();
