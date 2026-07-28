-- Self-service unlinking (Profile page): lets a signed-in User remove their
-- own link to a Player, mirroring link_self_to_player's own reasoning —
-- players_update_admin_owner is the only players UPDATE policy, so an
-- ordinary Participant has no RLS permission to clear their own user_id
-- either. SECURITY DEFINER for the same narrow reason: this only ever lets
-- a caller unlink *themselves*, nothing broader.
--
-- Squashed (Phase 10.6, folded back into this original migration — see
-- create_link_self_to_player.sql's own squash note): also unlinks the
-- Championship-flight sibling row, symmetric with that migration's
-- link-side fix, so unlinking one half of a Gross/Net pair can't leave the
-- other orphaned-but-still-linked. Only touches the sibling if it's linked
-- to the *same* caller — never unlinks someone else's link just because it
-- shares a name/flight, which would be a real privilege overreach for a
-- function whose whole contract is "unlink yourself, nothing broader."
create function public.unlink_self_from_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament_id uuid;
  current_owner uuid;
  unlinked_flight text;
  unlinked_division text;
  unlinked_first_name text;
  unlinked_last_name text;
  sibling_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to unlink a player';
  end if;

  select tournament_id, user_id, flight, division, first_name, last_name
  into target_tournament_id, current_owner, unlinked_flight, unlinked_division,
    unlinked_first_name, unlinked_last_name
  from public.players
  where id = p_player_id;

  if target_tournament_id is null then
    raise exception 'Player not found';
  end if;

  if current_owner is distinct from auth.uid() then
    raise exception 'You are not linked to this player';
  end if;

  update public.players
  set user_id = null
  where id = p_player_id and user_id = auth.uid();

  if not found then
    raise exception 'Not permitted to unlink this player';
  end if;

  perform public.log_audit_event(
    target_tournament_id, p_player_id, 'player_unlinked', 'Player', p_player_id,
    jsonb_build_object('user_id', auth.uid()),
    jsonb_build_object('user_id', null)
  );

  if unlinked_division in ('gross', 'net') then
    select id into sibling_id
    from public.players
    where tournament_id = target_tournament_id
      and flight = unlinked_flight
      and first_name = unlinked_first_name
      and last_name = unlinked_last_name
      and division = (case when unlinked_division = 'gross' then 'net' else 'gross' end)
      and user_id = auth.uid();

    if sibling_id is not null then
      update public.players
      set user_id = null
      where id = sibling_id and user_id = auth.uid();

      if found then
        perform public.log_audit_event(
          target_tournament_id, sibling_id, 'player_unlinked', 'Player', sibling_id,
          jsonb_build_object('user_id', auth.uid()),
          jsonb_build_object('user_id', null)
        );
      end if;
    end if;
  end if;
end;
$$;

grant execute on function public.unlink_self_from_player(uuid) to authenticated;
