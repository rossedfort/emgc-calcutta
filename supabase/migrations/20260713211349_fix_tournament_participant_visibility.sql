-- Fixes a gap from Phase 1.6: Participants should only see kind='production'
-- tournaments (dry runs are an Admin/Owner-only rehearsal concept), but the
-- original policy never actually encoded that restriction. Admin/Owner
-- continue to see every tournament regardless of kind.
drop policy "tournaments_select_participant_plus" on public.tournaments;

create policy "tournaments_select_participant_plus" on public.tournaments
for select to authenticated
using (
  (public.current_user_role() = 'participant' and kind = 'production')
  or public.current_user_role() in ('admin', 'owner')
);
