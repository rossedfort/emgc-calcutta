-- Phase 21: a floor on the very first bid an entry ever receives. Today
-- place-bid's high-bid check (`if (highBid && ...)`) is skipped entirely
-- when highBid is null, so a first bid of $0.01 is accepted — the only
-- other floor is the generic amount > 0 check. min_increment keeps
-- governing every bid after the first, unchanged; this only adds a floor
-- for the one bid that currently has none.
--
-- not null with a real default (not just a form-level one) — this table
-- already has rows (seed data, any real tournaments already created), so
-- a plain `not null` with no default would fail outright.
alter table public.tournaments
  add column minimum_bid numeric(10, 2) not null default 1.00;
