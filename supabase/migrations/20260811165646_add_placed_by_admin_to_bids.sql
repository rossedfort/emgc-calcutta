-- Phase 32: lets an Admin/Owner place a bid on behalf of a participant
-- (in-person silent/live auction bidding for non-tech-savvy participants).
-- Nullable — null for the overwhelming majority of bids, which are still
-- placed by the bidder themselves; set only when place-bid's caller
-- supplied a bidderId and the caller's own role authorized it.
--
-- on delete set null (not cascade), matching this table's other actor-ish
-- reference (bidder_id has no cascade either, and the Bid is a financial
-- record that shouldn't disappear if the acting admin's User row is later
-- removed) — see the create_bids migration's own reasoning.
--
-- No RLS change needed: bids_select_participant_plus already grants the
-- whole row (participants scoped to production tournaments, Admin/Owner
-- everywhere), same as bidder_name's own addition — this is presentational
-- (a "placed by admin" badge), not a new access concern.
alter table public.bids
  add column placed_by_admin_id uuid references public.users (id) on delete set null;
