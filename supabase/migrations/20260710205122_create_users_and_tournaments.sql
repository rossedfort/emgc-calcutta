-- Phase 1 foundation schema: User and Tournament.
-- See .claude/emgc-calcutta-app-spec.md section 5 (data model) and section 3 (roles).

create type user_role as enum ('unassigned', 'participant', 'admin', 'owner');

-- Only the three SSO providers spec section 4.1 calls for.
create type auth_provider as enum ('google', 'azure', 'apple');

-- Extends auth.users with the app-specific profile fields the spec's User
-- model calls for (role, phone, avatar, etc). Row creation/role assignment
-- (first-login "unassigned" landing, Owner bootstrap) is deliberately not
-- wired up here — that's its own backlog item ("First-login flow" /
-- "Bootstrap flow"), not part of the schema itself.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text not null,
  phone text,
  sso_provider auth_provider,
  avatar_url text,
  role user_role not null default 'unassigned',
  created_at timestamptz not null default now()
);

-- A single internal league runs one Tournament at a time; there's no
-- League/membership table (see spec section 5) so these settings live
-- directly here.
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  silent_auction_start timestamptz not null,
  silent_auction_end timestamptz not null,
  -- Coarse lifecycle state for admin UI/display purposes. This is
  -- deliberately not the authoritative gate for silent/live auction phase
  -- logic (spec 6.5 ties silent-auction close to silentAuctionEnd, and
  -- lot-level state lives on LiveLot) — Phase 3/4 may extend these values
  -- once that state machine is fully designed.
  status text not null default 'setup' check (status in ('setup', 'active', 'complete')),
  threshold_amount numeric(10, 2) not null,
  min_increment numeric(10, 2) not null,
  -- 15s is the example anti-snipe window from spec section 4.4.
  anti_snipe_seconds integer not null default 15,
  -- e.g. {"1": 0.5, "2": 0.3, "3": 0.2} — percentage of the pot per finishing place.
  payout_structure jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS is enabled on both tables now so they're never accidentally left
-- open, but no policies are added yet — that's the very next backlog item
-- ("RLS policies for User/Tournament"). Enabling RLS with zero policies
-- means both tables are unreachable via the API (service-role only) until
-- that task adds the real role-gated policies; this is the deliberate,
-- documented absence the task-workflow skill's RLS check calls for.
alter table public.users enable row level security;
alter table public.tournaments enable row level security;
