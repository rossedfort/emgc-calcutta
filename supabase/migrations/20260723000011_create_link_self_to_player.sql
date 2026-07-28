-- Self-service player linking (spec 4.9, Phase 10): lets a signed-in User
-- link themselves to any currently-unlinked Player in a tournament, with no
-- email-match restriction and no Admin-approval step (confirmed with the
-- user). Unlike open_live_lot/close_live_lot, this can't be a plain
-- SECURITY INVOKER function that leans on an existing RLS grant — the only
-- players UPDATE policy is players_update_admin_owner, so an ordinary
-- Participant caller has no RLS permission to set their own user_id at
-- all. This function supplies that one narrow capability (link *yourself*
-- to a currently-unlinked Player, nothing broader) as SECURITY DEFINER,
-- same elevated-access-through-a-narrow-door reasoning as log_audit_event.
--
-- Squashed (Phase 10.6, folded back into this original migration rather
-- than left as a separate create-then-alter pair — same precedent as the
-- earlier full migration squash and Phase 8's follow-on squash): also
-- links the Championship-flight sibling row (same tournament/flight/
-- first_name/last_name, opposite division — there's no shared "golfer id"
-- to join on) so a self-link to one half of a Gross/Net pair carries onto
-- the other, matching how CSV import used to link both at once before its
-- email-match auto-link was removed in favor of this self-service flow.
create function public.link_self_to_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament_id uuid;
  current_owner uuid;
  already_linked_id uuid;
  linked_flight text;
  linked_division text;
  linked_first_name text;
  linked_last_name text;
  sibling_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to link a player';
  end if;

  select tournament_id, user_id, flight, division, first_name, last_name
  into target_tournament_id, current_owner, linked_flight, linked_division,
    linked_first_name, linked_last_name
  from public.players
  where id = p_player_id;

  if target_tournament_id is null then
    raise exception 'Player not found';
  end if;

  if current_owner is not null then
    raise exception 'This player is already linked to someone else';
  end if;

  -- Mirrors the admin link form's own "already linked to a different
  -- player in this tournament" guard (players_tournament_id_user_id_
  -- division_key) — not division-scoped, same simpler "one player per
  -- tournament" reading that guard already uses. The Championship sibling
  -- linked automatically below is a deliberate, controlled exception to
  -- this rule, not a bypass of it — it's the same golfer, not a second one.
  select id into already_linked_id
  from public.players
  where tournament_id = target_tournament_id and user_id = auth.uid();

  if already_linked_id is not null then
    raise exception 'You''re already linked to a player in this tournament';
  end if;

  -- The `user_id is null` re-check in the WHERE clause (not just the
  -- earlier read above) is what makes this race-safe: if two people click
  -- "this is me" on the same player at once, only the first UPDATE
  -- matches a row — the second hits the FOUND check below instead of
  -- silently overwriting the first.
  update public.players
  set user_id = auth.uid()
  where id = p_player_id and user_id is null;

  if not found then
    raise exception 'This player was just linked to someone else — refresh and try again';
  end if;

  perform public.log_audit_event(
    target_tournament_id, p_player_id, 'player_linked', 'Player', p_player_id,
    jsonb_build_object('user_id', null),
    jsonb_build_object('user_id', auth.uid())
  );

  -- A Championship-flight golfer is two independent Player rows (Gross and
  -- Net, same tournament/flight/first_name/last_name, different division —
  -- there's no shared "golfer id" to join on, this name+flight match is the
  -- only correlation the schema has). Linking one half should carry onto
  -- the other, matching how CSV import used to link both at once. Silently
  -- does nothing if there's no sibling (an ordinary player), the sibling is
  -- already linked to someone else (don't steal it), or the sibling can't
  -- be found for any other reason — the primary link above has already
  -- succeeded and should not be undone by a problem with the secondary one.
  if linked_division in ('gross', 'net') then
    select id into sibling_id
    from public.players
    where tournament_id = target_tournament_id
      and flight = linked_flight
      and first_name = linked_first_name
      and last_name = linked_last_name
      and division = (case when linked_division = 'gross' then 'net' else 'gross' end)
      and user_id is null;

    if sibling_id is not null then
      update public.players
      set user_id = auth.uid()
      where id = sibling_id and user_id is null;

      if found then
        perform public.log_audit_event(
          target_tournament_id, sibling_id, 'player_linked', 'Player', sibling_id,
          jsonb_build_object('user_id', null),
          jsonb_build_object('user_id', auth.uid())
        );
      end if;
    end if;
  end if;
end;
$$;

grant execute on function public.link_self_to_player(uuid) to authenticated;
