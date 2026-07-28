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
-- Squashed (Phase 11): players is one row per real golfer now (see
-- create_players.sql), so this is a plain single-row update, full stop —
-- earlier versions of this function also had to link a Championship-flight
-- "sibling" row (same tournament/flight/first_name/last_name, opposite
-- division — there was no shared "golfer id" to join on, back when a
-- Championship golfer was two independent Player rows). That whole block
-- is gone: linking the one Player row a golfer now has automatically
-- covers every player_entries row they have, with no second write needed.
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
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to link a player';
  end if;

  select tournament_id, user_id into target_tournament_id, current_owner
  from public.players
  where id = p_player_id;

  if target_tournament_id is null then
    raise exception 'Player not found';
  end if;

  if current_owner is not null then
    raise exception 'This player is already linked to someone else';
  end if;

  -- Mirrors the admin link form's own "already linked to a different
  -- player in this tournament" guard (players_tournament_id_user_id_key) —
  -- plain "one player per tournament," no division exception needed
  -- anymore now that a golfer is always exactly one players row.
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
end;
$$;

grant execute on function public.link_self_to_player(uuid) to authenticated;
