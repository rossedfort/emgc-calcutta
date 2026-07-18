-- Phase 7.5 (flighted results & payouts): `tournaments.flights` becomes the
-- source of truth for a tournament's flight names and their display order —
-- `players.flight` (free text, unchanged) is expected to be displayed/sorted
-- in this order wherever it appears, not alphabetically. `championship_flight`
-- optionally designates one of those flights (if any) as the flight whose
-- players get auctioned twice, once for Gross and once for Net (spec gap
-- identified by the user, see this phase's own backlog header for the two
-- money-math decisions already confirmed: per-flight/division pot scoping,
-- shared payout_structure across Gross/Net).
alter table public.tournaments
  add column flights text[] not null default '{}'::text[];

alter table public.tournaments
  add column championship_flight text;

-- Same-row check, no trigger needed: championship_flight (if set) must
-- actually be one of this tournament's own configured flights.
alter table public.tournaments
  add constraint tournaments_championship_flight_in_flights
  check (championship_flight is null or championship_flight = any (flights));

-- `division` distinguishes a Championship-flight player's Gross entry from
-- their Net entry (each independently biddable, per the confirmed design);
-- 'overall' for every player in every other flight. Not nullable — unlike
-- `flight` below, this needs to participate in a unique index, and NULL
-- isn't reliably comparable there (see the `flight` fix immediately after
-- this for the exact bug that not-null default avoids).
alter table public.players
  add column division text not null default 'overall'
  check (division in ('overall', 'gross', 'net'));

-- `flight` itself was nullable (no rows currently have a NULL value — see
-- this task's own verification below) — worth fixing now rather than
-- leaving it, since the whole point of the index below is per-flight
-- placement uniqueness, and a NULL flight wouldn't collide with another
-- NULL flight in a unique index (Postgres treats NULL as distinct from
-- every other NULL), silently defeating that uniqueness for any player
-- with no flight assigned. '' (empty string, not NULL) means "no flight
-- assigned" from here on, matching this codebase's own established
-- default-to-empty-string convention (`tournaments.slug`, `players.slug`)
-- rather than introducing a new NULL-handling special case.
alter table public.players
  alter column flight set default ''::text;

alter table public.players
  alter column flight set not null;

-- Placement uniqueness (Phase 7's `players_tournament_id_placement_key`,
-- `(tournament_id, placement)`) moves to `(tournament_id, flight, division,
-- placement)` — every ordinary flight has `division = 'overall'` for every
-- player, so this degrades to exactly today's per-flight-implied behavior;
-- the Championship flight's Gross and Net entries now correctly rank (and
-- get placement-uniqueness-checked) independently of each other. `placement`
-- itself stays nullable and still coexists fine across any number of
-- not-yet-placed players, unchanged from the original index's own reasoning.
drop index public.players_tournament_id_placement_key;

create unique index players_tournament_id_placement_key
  on public.players (tournament_id, flight, division, placement);
