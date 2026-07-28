-- Reject action (Phase 12.5): lets an Admin/Owner mark a still-unassigned
-- signup as rejected (someone outside the league who signed in) without
-- deleting their row — a hard delete would either cascade or leave a
-- dangling auth.users row with no matching public.users profile, breaking
-- their session in a confusing way if they ever signed in again — and
-- without touching `role` at all (stays 'unassigned' throughout).
--
-- A nullable timestamp/actor pair, parallel to this same table's existing
-- name_confirmed_at column, rather than a new user_role enum value:
-- create_audit_events.sql already documents this project's own reasoning
-- for avoiding ALTER TYPE ... ADD VALUE churn (there, for action/
-- entity_type) — the same tradeoff applies here, and a fourth non-admin
-- role value would mean touching every role-based switch across
-- $lib/roles.ts, this function's own RBAC checks, and admin/users'
-- actionsFor(), for no logic-branching benefit over a flag.
--
-- Reversible by design (un-reject clears both back to null) — see
-- update-user-role's new reject/unreject actions — matching this app's
-- existing pattern of admin actions never being a true dead end (void-bid,
-- link/unlink).
alter table public.users
  add column rejected_at timestamptz,
  add column rejected_by uuid references public.users (id);

-- No RLS/grant changes needed: service_role already has full column access
-- (the existing `grant select, insert, update, delete on public.users to
-- service_role` from create_users.sql covers these two new columns too),
-- and — like `role` itself — these are never meant to be self-writable, so
-- no new column added to the `grant update (first_name, last_name,
-- name_confirmed_at) on public.users to authenticated` self-service grant.
-- The existing `users_select_self_or_admin` SELECT policy already lets a
-- user read their own row (including these new columns) and lets Admin/
-- Owner read everyone's, unchanged.
