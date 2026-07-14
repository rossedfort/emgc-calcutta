-- Phase 5 foundation: AuditEvent (spec 4.6, 5, 6.5). Every state-changing
-- action across the app writes one immutable row here — who, what, old
-- value -> new value, timestamp, and (for voids) the reason. Per spec
-- 6.5: "AuditEvent has no client-writable policy at all, from any role,
-- including Admin — only Supabase's service-role key can write to it."
-- That's the whole point of this table existing in Postgres rather than
-- as an application-level log: it's a guarantee the database enforces,
-- not a property of the application code remembering to call it.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: most events are tournament-scoped (bid placed, lot opened),
  -- but some aren't (a role change is a User-level action with no
  -- tournament of its own). `on delete set null` rather than cascade —
  -- same "preserve the historical record" reasoning already applied to
  -- Bid.player_id/LiveLot.player_id: an Owner deleting a tournament's
  -- data (spec 4.3's role table explicitly grants this) shouldn't also
  -- erase the accountability trail of what happened in it.
  tournament_id uuid references public.tournaments (id) on delete set null,
  -- Nullable + set null for the same reason: deleting a user (cascades
  -- from auth.users) shouldn't silently erase what they did.
  actor_id uuid references public.users (id) on delete set null,
  -- action/entity_type are plain text, not enums: unlike player_status/
  -- bid_phase (which branch application logic), these are descriptive/
  -- filterable-only, and spec 4.6's own action list already spans
  -- multiple future phases (Phase 6 notifications, Phase 7 payouts) —
  -- an enum would mean an ALTER TYPE ADD VALUE migration every time a
  -- later phase adds a new action, for no logic-branching benefit.
  action text not null,
  entity_type text not null,
  -- Polymorphic reference (a Bid, a Player, a User, ...) depending on
  -- entity_type — deliberately no FK, since no single table it always
  -- points to. before/after are self-contained snapshots, so the
  -- original entity doesn't need to still exist for this row to still
  -- make sense.
  entity_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_events_tournament_id_idx on public.audit_events (tournament_id);
create index audit_events_actor_id_idx on public.audit_events (actor_id);
create index audit_events_action_idx on public.audit_events (action);
create index audit_events_entity_type_entity_id_idx on public.audit_events (entity_type, entity_id);
create index audit_events_created_at_idx on public.audit_events (created_at);

alter table public.audit_events enable row level security;

-- No policies at all yet, deliberately (see the task-workflow skill's RLS
-- check) — the next backlog line ("Audit log query") adds the Admin/Owner
-- SELECT policy. RLS enabled with zero policies means this table is
-- completely unreachable via the API until that policy lands, which is
-- exactly the point: a client-writable window never opens, even briefly.
--
-- Grants mirror the eventual access shape rather than waiting for the
-- next task to add them (same approach live_lots took): authenticated
-- gets SELECT only (inert until the RLS policy exists, but no write
-- grant ever — matches "no client-writable policy at all, including
-- Admin"); service_role gets SELECT + INSERT only, not UPDATE/DELETE —
-- these rows are meant to be immutable, so the grant itself enforces
-- that rather than just a convention no one violates by habit.
grant select on public.audit_events to authenticated;
grant select, insert on public.audit_events to service_role;
