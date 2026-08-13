-- PlayerFavorite (Phase 39, user-requested): lets a Participant star/follow
-- players within a tournament, then filter the silent auction board down to
-- just their favorites. One row per (user, entry) — entry_id references
-- player_entries (the sellable unit, per create_player_entries.sql's own
-- header), not players, so favorites are scoped per-tournament: a
-- Championship golfer's Gross and Net entries can be favorited
-- independently, and a golfer favorited in one tournament isn't favorited
-- in another they're also entered in.
create table public.player_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  entry_id uuid not null references public.player_entries (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, entry_id)
);

create index player_favorites_user_id_idx on public.player_favorites (user_id);
create index player_favorites_entry_id_idx on public.player_favorites (entry_id);

alter table public.player_favorites enable row level security;

-- Self-only, no Admin override — same reasoning as notification_prefs
-- (create_notification_prefs.sql): nothing calls for an Admin to view or
-- manage another User's favorites. Unlike notification_prefs (a single
-- in-place toggle row), favoriting/unfavoriting is a real add/remove
-- action, so this needs delete too.
create policy "player_favorites_select_self" on public.player_favorites
for select to authenticated
using (user_id = auth.uid());

create policy "player_favorites_insert_self" on public.player_favorites
for insert to authenticated
with check (user_id = auth.uid());

create policy "player_favorites_delete_self" on public.player_favorites
for delete to authenticated
using (user_id = auth.uid());

-- authenticated needs the table-level grant for the self-only policies
-- above to have anything to act on (RLS filters rows, it doesn't imply the
-- underlying privilege). No update grant — a favorite is either present or
-- absent, never edited in place, matching the three policies above.
grant select, insert, delete on public.player_favorites to authenticated;
