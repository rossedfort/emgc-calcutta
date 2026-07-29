-- Stake buy-back (Phase 14 task 2) needs a golfer to see who bought their
-- own sold entry — the buy-back request modal shows the buyer's email and
-- phone number, and there's no other way to compose the ask. Found while
-- verifying /me/balance's new "Your stake" query directly against the
-- live REST endpoint as a real Participant session: the embedded
-- `buyer:users(...)` came back null, not because of a query bug but
-- because users_select_self_or_admin (create_users.sql) only lets a
-- Participant read their own row or an Admin/Owner's — nothing lets one
-- Participant read another's contact info, which is exactly right for
-- keeping bidder identity anonymous during an active auction (confirmed
-- product decision — participants never see who placed a bid, only the
-- amount) but wrongly blocks this narrower, already-decided case: once
-- an entry is sold, the golfer who was sold gets to see who bought them,
-- specifically to negotiate a buy-back.
--
-- Scoped as tightly as the actual need, not "any Participant can read any
-- other Participant" — a users row is only readable under this policy if
-- its id is the winning bidder on some entry whose linked golfer
-- (players.user_id) is the caller. This doesn't check
-- tournaments.buy_back_percentage at all: knowing who bought you, once
-- sold, is the same underlying fact regardless of whether buy-back
-- happens to be configured for that tournament — gating the *feature*
-- (the request button/modal) on buy_back_percentage already happens at
-- the application layer (request-stake-buyback, the /me/balance query),
-- this policy only needs to answer "is this a real buyer-of-my-stake
-- relationship," which doesn't depend on that setting.
create policy "users_select_own_buyer" on public.users
for select to authenticated
using (
  id in (
    select b.bidder_id
    from public.player_entries e
    join public.players p on p.id = e.player_id
    join public.bids b on b.id = e.winning_bid_id
    where p.user_id = auth.uid()
  )
);
