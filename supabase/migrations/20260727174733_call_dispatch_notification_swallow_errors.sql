-- Phase 9 backlog: call_dispatch_notification() can roll back the *entire*
-- enclosing statement if it raises -- verified directly in an earlier
-- phase: with a Vault secret in its placeholder "unset" state,
-- close_silent_auctions() failed completely, players.status never updated
-- at all, because the trigger's uncaught exception propagated up through
-- the whole UPDATE. This directly contradicts spec 4.7's "failed sends are
-- logged, not retried indefinitely, and don't block ... state" -- a
-- notification failure should never be able to block the underlying sale
-- from actually closing.
--
-- Fixed inside call_dispatch_notification() itself (create or replace),
-- not by wrapping each of its call sites individually: it's called from
-- three different trigger functions (notify_on_bid_insert -- outbid/
-- bid_on_you/reserved, notify_on_live_auction_starting, and
-- notify_on_player_sold -- won), five call sites total, and the backlog's
-- own wording ("Same exposure applies to close_live_lot()") already
-- recognizes the exposure isn't specific to one caller. Fixing the shared
-- function once protects every current caller (and any future one)
-- instead of duplicating a BEGIN/EXCEPTION block five times.
--
-- RAISE WARNING (not an audit_events row): this is a setup/connectivity-
-- level failure -- a bad Vault secret, net.http_post itself erroring --
-- happening *before* the actual dispatch-notification function ever runs,
-- distinct from a real send failure once it does (which that function
-- already logs to audit_events itself, e.g. notification_failed). A
-- Postgres WARNING is visible in the server logs without inventing new
-- audit-event plumbing for what's meant to be a rare/setup-error case, not
-- a normal operational failure mode.
create or replace function public.call_dispatch_notification(payload jsonb)
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
    from vault.decrypted_secrets where name = 'dispatch_notification_url';

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
    raise warning 'call_dispatch_notification failed (payload %): %', payload, sqlerrm;
  end;
end;
$$;
