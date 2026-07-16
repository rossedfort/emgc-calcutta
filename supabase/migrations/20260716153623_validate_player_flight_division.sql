-- Phase 7.5 task 2: schema alone (the previous migration) can't enforce
-- these two invariants, since both need to compare a `players` row against
-- its *owning tournament's* configuration, not just its own columns:
--   1. `players.flight` (when set) must be one of the owning tournament's
--      configured `flights` — '' (this codebase's "no flight assigned"
--      convention, see the previous migration) is always allowed regardless
--      of what's configured, since it means "not assigned to a flight yet."
--   2. `players.division` must be 'gross' or 'net' if and only if
--      `flight = championship_flight`; every other flight (including '')
--      must be 'overall'.
--
-- Plain SECURITY INVOKER (the default) — matches this codebase's
-- established "no more authority than the caller already has" pattern.
-- Works here because both write paths that reach this trigger already
-- have their own read access to `tournaments`: the player new/edit forms
-- run as the caller's own authenticated (Admin/Owner) session, which
-- already has broad SELECT on `tournaments` (every admin page depends on
-- it); `import-csv-confirm` writes via its service-role client, which
-- bypasses RLS entirely. No elevated privilege needed beyond what each
-- caller's own write already runs with.
create function public.validate_player_flight_division()
returns trigger
language plpgsql
as $$
declare
  v_flights text[];
  v_championship_flight text;
begin
  select flights, championship_flight
    into v_flights, v_championship_flight
  from public.tournaments
  where id = NEW.tournament_id;

  if NEW.flight != '' and not (NEW.flight = any (v_flights)) then
    raise exception
      'Flight "%" is not configured for this tournament. Add it to the tournament''s flights list first.',
      NEW.flight;
  end if;

  if v_championship_flight is not null and NEW.flight = v_championship_flight then
    if NEW.division not in ('gross', 'net') then
      raise exception
        'Players in the Championship flight ("%") must have a division of ''gross'' or ''net'', not ''%''.',
        v_championship_flight, NEW.division;
    end if;
  else
    if NEW.division != 'overall' then
      raise exception
        'Division ''%'' is only valid for a player in the Championship flight; this player''s flight is "%".',
        NEW.division, NEW.flight;
    end if;
  end if;

  return NEW;
end;
$$;

-- Column-scoped on UPDATE (not on every column) — a player row gets
-- updated for plenty of reasons unrelated to flight/division (placement,
-- paid status, bid linkage), and re-validating a *stale* flight/division
-- combination on every unrelated write would incorrectly block those
-- writes for any tournament that hasn't configured `flights` yet.
-- Re-validates on `tournament_id` too for the (currently theoretical)
-- case of a player ever being reassigned to a different tournament.
create trigger players_validate_flight_division
before insert or update of flight, division, tournament_id on public.players
for each row
execute function public.validate_player_flight_division();
