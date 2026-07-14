-- Reads: Participants see bids only within tournaments they can see at all
-- (kind='production' — see players_select_participant_plus for the same
-- pattern one join shallower); Admin/Owner see every bid in every
-- tournament. This is deliberately NOT scoped to "tournaments this
-- Participant is rostered in" — spec 4.3 requires every connected client to
-- see updated high bids in near-real-time, which means seeing bid activity
-- on players you aren't bidding on too, not just your own bid history.
--
-- No insert/update/delete policy is added here, or ever will be — that's
-- not an oversight, it's the point (see the create_bids migration): every
-- bid goes through the place-bid Edge Function via the service-role
-- client, which bypasses RLS entirely and validates against current state
-- before writing.
create policy "bids_select_participant_plus" on public.bids
for select to authenticated
using (
  public.current_user_role() in ('admin', 'owner')
  or (
    public.current_user_role() = 'participant'
    and exists (
      select 1 from public.players p
      join public.tournaments t on t.id = p.tournament_id
      where p.id = bids.player_id and t.kind = 'production'
    )
  )
);
