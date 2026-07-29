-- Symmetric counterpart to users_select_own_buyer (Phase 14 task 2's own
-- migration): that one lets a golfer read the winning bidder's contact
-- info to compose a buy-back request; this lets the buyer read the
-- golfer's name back, needed for /me/balance's "What you owe" section
-- (task 3) to show whose request an Accept/Reject action applies to.
-- Found the same way — verifying the new query directly against the live
-- REST endpoint as a real buyer session, not assumed.
--
-- Same narrow shape as users_select_own_buyer: a users row is readable
-- under this policy only if its id is the requester on some
-- stake_buybacks row where the caller is that row's buyer — not "any
-- Participant can read any other Participant."
create policy "users_select_own_requester" on public.users
for select to authenticated
using (
  id in (
    select sb.requester_id
    from public.stake_buybacks sb
    where sb.buyer_id = auth.uid()
  )
);
