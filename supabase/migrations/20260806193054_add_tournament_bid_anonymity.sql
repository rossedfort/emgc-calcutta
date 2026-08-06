-- Per-tournament bidder-name display toggle. Purely presentational — the
-- silent auction board's high-bid display and the participant-facing
-- results page's "Won by {bidder_name}" both already read bids.bidder_name
-- via bids_select_participant_plus, which this doesn't change; when enabled,
-- those two spots suppress the name and show just the amount instead. No
-- RLS/security change needed, since bidder_name stays readable regardless —
-- this only controls whether the frontend renders it.
--
-- default false preserves every existing tournament's current
-- (bidder-name-visible) behavior unchanged.
alter table public.tournaments
  add column bid_anonymity_enabled boolean not null default false;
