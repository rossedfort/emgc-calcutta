-- Phase 15: public-facing (all-authenticated) tournament results page needs
-- every player's payout visible, not just the viewer's own — the existing
-- payouts_select_self_or_admin_owner policy only lets a participant read
-- their own bidder_id rows. Additive, not a replacement: Postgres RLS
-- policies for the same command are OR'd together, so this widens reads
-- without touching the existing self/admin policy at all.
--
-- Scoped to status = 'complete' tournaments specifically, not "any
-- authenticated user, any time" — final payout numbers become visible once
-- a tournament is actually over, matching this page's whole reason for
-- existing, not mid-tournament while placements/payouts could still change.
create policy "payouts_select_completed_tournament" on public.payouts
for select to authenticated
using (
  exists (
    select 1
    from public.tournaments t
    where t.id = payouts.tournament_id
      and t.status = 'complete'
  )
);
