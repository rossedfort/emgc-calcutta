-- Shows the current high bidder's name next to the amount on the
-- participant-facing Silent Auction board — a deliberate reversal of the
-- earlier "bids stay anonymous to other participants" decision, confirmed
-- explicitly rather than assumed (this app's own /help copy previously
-- promised the opposite; that copy is updated in the same change as this
-- migration).
--
-- Denormalized onto the bids row itself at write time (place-bid), not
-- read live from `users` per row: it rides along on the existing
-- postgres_changes Realtime channel with zero extra queries, and it's
-- already covered by bids_select_participant_plus's existing whole-row
-- grant to any participant on a production-tournament entry — the exact
-- same policy that already exposes `amount` to every participant, so no
-- separate RLS or `users`-table change is needed here.
--
-- Nullable, not backed by a check constraint: first_name/last_name on
-- `users` are themselves nullable (a user can exist pre-name-confirmation
-- per the Phase 12 sign-in flow), so a bid could in principle be placed
-- before a name is set. The UI simply omits the "(name)" suffix when this
-- is null, same as it already omits "Current high" entirely when there's
-- no bid at all.
alter table public.bids add column bidder_name text;

update public.bids b
set bidder_name = nullif(
  trim(concat(coalesce(u.first_name, ''), ' ', coalesce(u.last_name, ''))),
  ''
)
from public.users u
where u.id = b.bidder_id;
