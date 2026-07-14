-- Closes a gap between the spec's intended CSV import columns and the
-- actual Player model: spec 4.2 lists "handicap" as an importable CSV
-- column, but Player never had a dedicated field for it, so it was
-- silently landing nowhere distinct from the free-text preferences
-- column. Nullable — not every imported/added player will have a known
-- handicap index at creation time. numeric(4,1) comfortably covers the
-- real USGA Handicap Index range (roughly -10.0 to 54.0, one decimal
-- place of precision) with headroom to spare.
alter table public.players add column handicap_index numeric(4, 1);
