-- Self-service unlinking (Profile page): lets a signed-in User remove their
-- own link to a Player, mirroring link_self_to_player's own reasoning —
-- players_update_admin_owner is the only players UPDATE policy, so an
-- ordinary Participant has no RLS permission to clear their own user_id
-- either. SECURITY DEFINER for the same narrow reason: this only ever lets
-- a caller unlink *themselves*, nothing broader.
create function public.unlink_self_from_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament_id uuid;
  current_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to unlink a player';
  end if;

  select tournament_id, user_id into target_tournament_id, current_owner
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
end;
$$;

grant execute on function public.unlink_self_from_player(uuid) to authenticated;
