-- Phase 7.5 task 4: a Championship-flight golfer with a linked Participant
-- account now needs that account linked to *both* their Gross and Net
-- entries (two separate players rows, per the confirmed CSV-import design),
-- not just one — but the original `unique (tournament_id, user_id)`
-- constraint (Phase 2) only ever allowed a User to be linked to a single
-- Player per tournament, full stop. Relaxed to `(tournament_id, user_id,
-- division)`: a User can still link to at most one player per tournament
-- for any given division, which is exactly as strict as before for every
-- ordinary (non-Championship) player — those are always division='overall',
-- so nothing changes for them — while permitting the same User to link to
-- both their 'gross' and 'net' rows, which necessarily differ in division.
alter table public.players
  drop constraint players_tournament_id_user_id_key;

alter table public.players
  add constraint players_tournament_id_user_id_division_key
  unique (tournament_id, user_id, division);
