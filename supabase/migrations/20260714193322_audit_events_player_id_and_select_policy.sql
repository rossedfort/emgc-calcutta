-- Audit log query (spec 4.6, 6.5): Admin/Owner can read audit_events,
-- filterable by player, participant, action type, and time range.
--
-- actor_id (participant), action (action type), and created_at (time
-- range) already exist as plain top-level columns, so those three
-- filters fall out of the SELECT policy below for free via ordinary
-- PostgREST query params (.eq()/.gte()/.lte()) — no bespoke query
-- function needed, matching spec 6.6's "simple reads and role-gated
-- reads go straight through supabase-js against RLS-protected tables."
--
-- "Filter by player" is the one that needed a schema decision first:
-- entity_id is a polymorphic reference (a bid-placed event's entity is
-- the Bid, not the Player, even though it's clearly "about" a player),
-- so filtering on entity_id alone would silently miss every non-Player-
-- entity event tied to that player. Confirmed with the user: add a
-- denormalized player_id column, same pattern already used for
-- tournament_id — every player-related event carries it directly
-- alongside its polymorphic entity_type/entity_id, regardless of what
-- kind of event it is. Nullable (not every event is player-related) with
-- on delete set null, matching tournament_id/actor_id's own "preserve
-- the historical record" reasoning.
alter table public.audit_events
  add column player_id uuid references public.players (id) on delete set null;

create index audit_events_player_id_idx on public.audit_events (player_id);

-- Admin/Owner only, matching spec's `/admin/audit` route access and this
-- backlog line's own wording — no Participant visibility at all, unlike
-- most other tables in this app. This is the *only* policy audit_events
-- will ever have: still zero client-writable policies, per spec 6.5.
create policy "audit_events_select_admin_owner" on public.audit_events
for select to authenticated
using (public.current_user_role() in ('admin', 'owner'));
