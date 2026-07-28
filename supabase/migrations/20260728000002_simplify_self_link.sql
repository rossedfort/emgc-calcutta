-- Real bug found while testing this task, fixed here rather than by
-- amending the already-applied task-1 migration: log_audit_event's
-- `create or replace function` there added a trailing p_entry_id
-- parameter, going from 7 arguments to 8 — but CREATE OR REPLACE FUNCTION
-- only replaces a function whose argument *count and types* match exactly
-- (defaults don't collapse two different arities into "the same"
-- function for this purpose); a differently-shaped argument list creates
-- a second, overloaded function instead. This left two log_audit_event
-- overloads (7-arg and 8-arg) both matching a 7-positional-argument call
-- with no way for Postgres to pick one — confirmed directly: calling
-- link_self_to_player failed with "function ... is not unique" before
-- this fix. Dropping the stale 7-arg signature resolves the ambiguity;
-- the 8-arg version (with p_entry_id defaulted) already has the correct,
-- final body from task 1.
drop function if exists public.log_audit_event(uuid, uuid, text, text, uuid, jsonb, jsonb);

-- Phase 11 task 3: link_self_to_player()/unlink_self_from_player() lose
-- their entire sibling-matching block. That logic existed only because a
-- Championship-flight golfer used to be two independent `players` rows
-- with no real FK between them (see create_player_entries.sql's header) —
-- now that `players` is one row per real competitor, `user_id` naturally
-- covers every division a golfer has (their `player_entries` rows all
-- share the same `player_id`), so linking/unlinking is just a single-row
-- update, full stop. A genuine code deletion, not an addition — the
-- clearest sign this redesign is doing its job.
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

create or replace function public.unlink_self_from_player(p_player_id uuid)
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
