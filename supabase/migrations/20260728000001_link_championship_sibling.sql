-- Real gap found in manual testing: linking a User to a Championship-flight
-- Player only ever set user_id on that one row — never the sibling Gross/Net
-- row for the same golfer (Phase 7.5's CSV-import auto-link used to handle
-- this by inserting both rows pre-linked in the same statement, but that
-- email-match auto-link was removed in Phase 10 in favor of self-service
-- linking, which was never taught about Championship pairs). The unique
-- index was deliberately relaxed to (tournament_id, user_id, division) back
-- in Phase 7.5 specifically to let one account hold both rows at once — that
-- capability has been unreachable through any UI path since Phase 10 shipped.
--
-- create or replace, not an edit to the already-applied historical file,
-- matching this codebase's established post-squash convention.
create or replace function public.link_self_to_player(p_player_id uuid)
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

-- Symmetric fix for the unlink direction: leaving the sibling still linked
-- after unlinking one half would recreate the exact same
-- one-golfer-two-owners inconsistency this migration's link-side fix exists
-- to prevent. Only touches the sibling if it's linked to the *same* caller
-- (auth.uid()) — never unlinks someone else's link just because it happens
-- to share a name/flight, which would be a real privilege overreach for a
-- function whose whole contract is "unlink yourself, nothing broader."
create or replace function public.unlink_self_from_player(p_player_id uuid)
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
