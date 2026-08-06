-- Phase 20: "The Field" — schema foundation for pooling zero-bid players
-- into one sellable lot per (tournament, flight, division) group, instead
-- of letting them dead-end at no_bid with no pot contribution.
--
-- Three additions, no new tables — the field lot is a normal PlayerEntry
-- with a synthetic Player identity, so it fits every existing "a player"
-- view and FK for free:
--   1. 'field' added to player_status — the new terminal status a swept
--      entry (zero non-voided silent bids at close) moves to instead of
--      no_bid. Added in its own statement, and not referenced anywhere
--      else in this same migration (no DML compares a column to it) —
--      Postgres requires a new enum value to be committed before it can
--      be used in a query, so close_silent_auctions()'s own rework
--      (which does use it) has to land in a later migration regardless.
--   2. players.is_field — flags the synthetic "The Field" identity rows
--      this phase creates, so the UI can tell a real competitor from a
--      pooled lot at a glance without guessing from the name.
--   3. player_entries.field_entry_id — set on a swept entry, pointing at
--      the group's own field PlayerEntry (which is what actually gets
--      bid on and sold). on delete set null mirrors winning_bid_id's own
--      precedent immediately below it (this table's existing "outcome
--      pointer" column) rather than leaving it NO ACTION.
alter type public.player_status add value 'field';

alter table public.players
  add column is_field boolean not null default false;

alter table public.player_entries
  add column field_entry_id uuid references public.player_entries (id) on delete set null;

create index player_entries_field_entry_id_idx on public.player_entries (field_entry_id);
