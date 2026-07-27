-- Phase 9 backlog: voiding a closed live lot's winning bid (void-bid's
-- confirmed auto-fall-through recompute) updates players.winning_bid_id to
-- the new highest surviving bidder but leaves players.status untouched --
-- it was already 'sold_live' and stays 'sold_live'. players_notify_sold's
-- WHEN clause only fired on an actual status transition
-- (`OLD.status is distinct from NEW.status`), so the new winner never got
-- a "you won" notification the original winner got when the lot first
-- closed -- notify_on_player_sold() itself already recomputes the current
-- non-voided high bidder fresh from public.bids (it never trusted
-- NEW.winning_bid_id in the first place), so the fix is purely about
-- making the trigger fire for this case, not the notification logic.
--
-- Widened to also fire when winning_bid_id itself changes while status
-- stays sold (silent or live) -- confirmed this is the *only* other writer
-- of players.winning_bid_id besides the two close functions (which already
-- transition status and so already fire under the original clause): a
-- void-triggered no_bid recompute (no surviving bid at all) is unaffected,
-- since 'no_bid' was never in the NEW.status IN (...) list to begin with,
-- matching notify_on_player_sold()'s own "no_bid is deliberately excluded
-- -- that's not a 'won' outcome" comment.
create or replace trigger players_notify_sold
after update on public.players
for each row
when (
  NEW.status in ('sold_silent', 'sold_live')
  and (OLD.status is distinct from NEW.status or OLD.winning_bid_id is distinct from NEW.winning_bid_id)
)
execute function public.notify_on_player_sold();
