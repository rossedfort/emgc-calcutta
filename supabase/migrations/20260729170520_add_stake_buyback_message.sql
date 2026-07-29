-- Stake buy-back (Phase 14 follow-up): the requesting golfer can add a
-- personal note to their buy-back ask, sent as part of the automated
-- stake_buyback_requested email alongside the pre-baked "X wants to buy
-- back Y% for $Z" copy — not a mailto: draft (that idea was tried and
-- explicitly dropped, see BuyBackModal.svelte git history), so the note
-- has to travel through the same request-stake-buyback -> Postgres
-- trigger -> dispatch-notification pipeline the request itself already
-- uses. Nullable/optional, same "blank means the golfer skipped it"
-- precedent as every other optional field in this table's own migration.
alter table public.stake_buybacks
  add column message text check (char_length(message) <= 1000);

-- notify_on_stake_buyback_requested() (Phase 14 task 2) needs to forward
-- this new column into the dispatch-notification payload — replacing the
-- function body rather than a separate migration-only patch, since
-- CREATE OR REPLACE is how every other notification trigger function in
-- this project evolves.
create or replace function public.notify_on_stake_buyback_requested()
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
    'trigger', 'stake_buyback_requested',
    'tournamentId', NEW.tournament_id,
    'playerId', v_player_id,
    'amount', NEW.amount,
    'percentage', NEW.percentage,
    'message', NEW.message
  ));
  return NEW;
end;
$$;
