-- Phase 33: a golfer's buy-back request auto-approves (no buyer action
-- needed) whenever the percentage they ask for is at or below the
-- tournament's configured buy_back_percentage, which becomes an
-- approval ceiling rather than the one fixed rate every request used to
-- get. request-stake-buyback now inserts such a request directly as
-- status = 'accepted' instead of 'pending'.
--
-- auto_approved is kept as an explicit column rather than inferred from
-- responded_by is null (also true for a still-pending row, and would
-- need a second condition on status anyway) — bookkeeping/admin views
-- and this migration's own notification trigger below both want a plain
-- boolean to check, not a compound inference.
alter table public.stake_buybacks
  add column auto_approved boolean not null default false;

-- The existing after-insert trigger (see
-- 20260729145114_add_stake_buyback_requested_notification.sql) fired
-- unconditionally on every insert, which was fine when every insert was
-- necessarily status = 'pending' — no longer true now that an
-- auto-approved request inserts directly as 'accepted'. Recreated with
-- the same WHEN guard the after-repending trigger already uses, so an
-- auto-approved insert doesn't also wrongly email the buyer a "please
-- respond" notice they have nothing to respond to.
drop trigger stake_buybacks_notify_after_insert on public.stake_buybacks;

create trigger stake_buybacks_notify_after_insert
after insert on public.stake_buybacks
for each row
when (NEW.status = 'pending')
execute function public.notify_on_stake_buyback_requested();

-- stake_buyback_auto_approved notification: tells the buyer their stake
-- was split without needing their input — FYI-only wording, distinct
-- from stake_buyback_requested's "please respond" copy, since there's
-- nothing for them to do. No equivalent golfer-facing notification: the
-- golfer is the one submitting the request, so request-stake-buyback's
-- own response already confirms the outcome synchronously in the UI the
-- moment they submit — an async email to themselves would be redundant.
--
-- Two triggers sharing one function, same reasoning as the requested/
-- repending pair above: a fresh auto-approved request inserts directly
-- with status = 'accepted', but re-requesting after an earlier rejection
-- updates that same row instead of inserting a new one, and that second
-- path can also land on an auto-approved outcome if the golfer picks a
-- lower percentage on retry.
create function public.notify_on_stake_buyback_auto_approved()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
  v_player_id uuid;
begin
  select t.kind, e.player_id into v_kind, v_player_id
  from public.player_entries e
  join public.tournaments t on t.id = e.tournament_id
  where e.id = NEW.entry_id;

  if v_kind != 'production' then
    return NEW;
  end if;

  perform public.call_dispatch_notification(jsonb_build_object(
    'userId', NEW.buyer_id,
    'trigger', 'stake_buyback_auto_approved',
    'tournamentId', NEW.tournament_id,
    'playerId', v_player_id,
    'amount', NEW.amount,
    'percentage', NEW.percentage
  ));
  return NEW;
end;
$$;

create trigger stake_buybacks_notify_after_auto_approve_insert
after insert on public.stake_buybacks
for each row
when (NEW.status = 'accepted' and NEW.auto_approved)
execute function public.notify_on_stake_buyback_auto_approved();

create trigger stake_buybacks_notify_after_auto_approve_repending
after update on public.stake_buybacks
for each row
when (
  OLD.status = 'rejected'
  and NEW.status = 'accepted'
  and NEW.auto_approved
)
execute function public.notify_on_stake_buyback_auto_approved();
