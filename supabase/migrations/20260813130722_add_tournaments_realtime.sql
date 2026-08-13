-- tournaments wasn't previously replicated over Realtime — only players,
-- player_entries, live_lots, bids, and audit_events were (see their own
-- create-table migrations). The tournament layout (apps/web
-- /routes/(app)/tournaments/[slug]/+layout.svelte) now subscribes to
-- postgres_changes on this table to pick up live_auction_started_at flipping
-- (the Admin starting the live auction) without a page reload; without this
-- publication entry that subscription connects successfully but silently
-- never receives any event.
alter publication supabase_realtime add table public.tournaments;
