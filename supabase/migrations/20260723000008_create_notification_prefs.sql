-- NotificationPref (spec 4.7/5, adapted per an explicit deviation: this app
-- is email-only, Twilio/SMS is dropped rather than deferred, so the
-- smsEnabled/phone columns spec 5 lists are never built). One row per User
-- (not per Player) — notifications are a User-account concept per spec
-- 4.7/4.9, someone linked to multiple tournaments' Players still has just
-- one set of preferences.
create table public.notification_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  email_enabled boolean not null default true,
  -- Five keys for the five distinct triggers spec 4.7 defines: outbid,
  -- bid-on-you, player-reserved, live-auction-starting, lot-won.
  triggers jsonb not null default '{
    "outbid": true,
    "bid_on_you": true,
    "reserved": true,
    "live_starting": true,
    "won": true
  }'::jsonb,
  created_at timestamptz not null default now()
);

create index notification_prefs_user_id_idx on public.notification_prefs (user_id);

alter table public.notification_prefs enable row level security;

-- Self-only, no Admin override — matches spec 6.9's route table
-- (`/settings/notifications`, access: Self) exactly; nothing in spec 4.7
-- calls for an Admin to view or manage another User's notification
-- preferences, unlike most other tables in this app.
create policy "notification_prefs_select_self" on public.notification_prefs
for select to authenticated
using (user_id = auth.uid());

create policy "notification_prefs_insert_self" on public.notification_prefs
for insert to authenticated
with check (user_id = auth.uid());

create policy "notification_prefs_update_self" on public.notification_prefs
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- authenticated needs the table-level grant for the self-only policies
-- above to have anything to act on (RLS filters rows, it doesn't imply the
-- underlying privilege) — no delete grant, there's no "delete my
-- notification prefs" flow in spec 4.7, just toggles.
grant select, insert, update on public.notification_prefs to authenticated;

-- dispatch-notification runs under service_role and bypasses RLS entirely,
-- so it needs only the grant, not a policy.
grant select, insert, update, delete on public.notification_prefs to service_role;
