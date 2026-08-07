// Parses an Admin-uploaded player CSV for a specific tournament and
// validates each row — this is the preview step (spec 4.2): nothing is
// written here, that's import-csv-confirm's job once the Admin reviews and
// confirms this payload. No longer auto-matches against public.users —
// self-service linking (Phase 10) is now the only way a Player gets
// connected to a User; a brand-new (blank-id) row always starts unlinked.
//
// Upsert support: a non-blank `id`/`player_id` column matches an existing
// player in this tournament and is diffed field-by-field against the
// current DB row (see ImportCsvPreviewFieldChange) rather than treated as a
// fresh insert — this is what lets an Admin export the roster, hand-edit
// it, and re-upload to both add new players and update existing ones in
// one pass. A blank id is always a new player, same as before this task.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import Papa from "papaparse";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import type {
  ImportCsvPreviewFieldChange,
  ImportCsvPreviewRequest,
  ImportCsvPreviewResponse,
  ImportCsvPreviewRow,
} from "../_shared/contracts/import-csv-preview.ts";

// CSV headers accepted for each Player field (spec 4.2 also lists "tee
// time / group" and "starting bid", but neither maps to a Player column —
// see spec 5's actual data model — so they're not recognized here; a
// "notes/preferences" column can carry that info as free text if an Admin
// wants it captured, and starting bid has nowhere to go until Phase 3's
// Bid table exists. "handicap" maps to handicap_index — Phase 3.5 added
// that column specifically to close this gap). "id" is the round-trip key
// from the roster export (see the players/export route) — not a Player
// column an Admin fills in by hand, but recognized here the same way.
const HEADER_ALIASES: Record<string, string> = {
  "id": "id",
  "player_id": "id",
  "player id": "id",
  "first_name": "first_name",
  "first name": "first_name",
  "firstname": "first_name",
  "last_name": "last_name",
  "last name": "last_name",
  "lastname": "last_name",
  "flight": "flight",
  "handicap": "handicap_index",
  "handicap_index": "handicap_index",
  "handicap index": "handicap_index",
  "hcp": "handicap_index",
  "index": "handicap_index",
  "preferences": "preferences",
  "notes": "preferences",
  "notes/preferences": "preferences",
  "photo_url": "photo_url",
  "photo url": "photo_url",
  "photo": "photo_url",
};

function normalizeHeader(header: string): string | null {
  return HEADER_ALIASES[header.trim().toLowerCase()] ?? null;
}

interface ExistingPlayer {
  id: string;
  first_name: string;
  last_name: string;
  flight: string;
  handicap_index: number | null;
  preferences: string | null;
  photo_url: string | null;
}

function isChampionship(
  flight: string,
  championshipFlight: string | null,
): boolean {
  return !!championshipFlight && flight === championshipFlight;
}

export default {
  fetch: withSupabase<Database>(
    { auth: "user", env: resolveSupabaseEnv() },
    async (req, ctx) => {
      const { data: caller, error: callerError } = await ctx.supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", ctx.userClaims!.id)
        .single();
      if (callerError) {
        return Response.json({ error: callerError.message }, { status: 500 });
      }
      if (!isAdminOrOwner(caller.role)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      const body = await req.json().catch(() => null) as
        | Partial<ImportCsvPreviewRequest>
        | null;
      if (!body?.tournamentId || typeof body.csv !== "string") {
        return Response.json(
          { error: "tournamentId and csv are required" },
          { status: 400 },
        );
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select("id, flights, championship_flight")
        .eq("id", body.tournamentId)
        .maybeSingle();
      if (tournamentError) {
        return Response.json({ error: tournamentError.message }, {
          status: 500,
        });
      }
      if (!tournament) {
        return Response.json({ error: "Tournament not found" }, {
          status: 404,
        });
      }

      const parsed = Papa.parse<Record<string, string>>(body.csv, {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length > 0) {
        return Response.json(
          { error: `CSV parse error: ${parsed.errors[0].message}` },
          { status: 400 },
        );
      }

      const fieldMap = new Map<string, string>();
      for (const header of parsed.meta.fields ?? []) {
        const normalized = normalizeHeader(header);
        if (normalized && !fieldMap.has(normalized)) {
          fieldMap.set(normalized, header);
        }
      }

      const getField = (row: Record<string, string>, field: string) => {
        const column = fieldMap.get(field);
        const value = column ? row[column]?.trim() : "";
        return value ? value : null;
      };

      // Unlike the other fields, an unparseable handicap is a row error
      // rather than silently dropped — an Admin reviewing the preview
      // should see that something in the CSV didn't look like a number,
      // not just find handicap_index quietly blank after import.
      const getHandicap = (
        row: Record<string, string>,
        errors: string[],
      ): number | null => {
        const raw = getField(row, "handicap_index");
        if (raw === null) return null;
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          errors.push("Handicap must be a number");
          return null;
        }
        return value;
      };

      interface BaseRow {
        rowNumber: number;
        id: string | null;
        first_name: string | null;
        last_name: string | null;
        flight: string;
        handicap_index: number | null;
        preferences: string | null;
        photo_url: string | null;
        errors: string[];
      }

      const baseRows: BaseRow[] = parsed.data.map(
        (row: Record<string, string>, index: number) => {
          const first_name = getField(row, "first_name");
          const last_name = getField(row, "last_name");
          const errors: string[] = [];
          if (!first_name) errors.push("First name is required");
          if (!last_name) errors.push("Last name is required");
          const handicap_index = getHandicap(row, errors);
          const flight = getField(row, "flight") ?? "";
          if (flight && !tournament.flights.includes(flight)) {
            errors.push(
              `Flight "${flight}" is not configured for this tournament`,
            );
          }

          return {
            rowNumber: index + 2, // header row + 1-indexing
            id: getField(row, "id"),
            first_name,
            last_name,
            flight,
            handicap_index,
            preferences: getField(row, "preferences"),
            photo_url: getField(row, "photo_url"),
            errors,
          };
        },
      );

      // A duplicate id in the file is ambiguous (which row's edits win?) —
      // flagged on every row sharing it rather than silently letting the
      // last one win.
      const idCounts = new Map<string, number>();
      for (const row of baseRows) {
        if (row.id) idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
      }

      const ids = [...idCounts.keys()];
      const existingPlayers = new Map<string, ExistingPlayer>();
      const entriesByPlayerId = new Map<
        string,
        {
          id: string;
          division: string;
          status: string;
          placement: number | null;
        }[]
      >();
      const entryIdsWithBids = new Set<string>();

      if (ids.length > 0) {
        const { data: players, error: playersError } = await ctx.supabaseAdmin
          .from("players")
          .select(
            "id, first_name, last_name, flight, handicap_index, preferences, photo_url",
          )
          .eq("tournament_id", body.tournamentId)
          .in("id", ids);
        if (playersError) {
          return Response.json({ error: playersError.message }, {
            status: 500,
          });
        }
        for (const player of players ?? []) {
          existingPlayers.set(player.id, player);
        }

        const { data: entries, error: entriesError } = await ctx.supabaseAdmin
          .from("player_entries")
          .select("id, player_id, division, status, placement")
          .in("player_id", ids);
        if (entriesError) {
          return Response.json({ error: entriesError.message }, {
            status: 500,
          });
        }
        for (const entry of entries ?? []) {
          const list = entriesByPlayerId.get(entry.player_id) ?? [];
          list.push(entry);
          entriesByPlayerId.set(entry.player_id, list);
        }

        const entryIds = (entries ?? []).map((e) => e.id);
        if (entryIds.length > 0) {
          const { data: bids, error: bidsError } = await ctx.supabaseAdmin
            .from("bids")
            .select("entry_id")
            .in("entry_id", entryIds);
          if (bidsError) {
            return Response.json({ error: bidsError.message }, { status: 500 });
          }
          for (const bid of bids ?? []) entryIdsWithBids.add(bid.entry_id);
        }
      }

      const rows: ImportCsvPreviewRow[] = baseRows.map((base) => {
        const errors = [...base.errors];
        if (base.id && (idCounts.get(base.id) ?? 0) > 1) {
          errors.push("This player ID appears more than once in the file");
        }

        if (!base.id) {
          return {
            rowNumber: base.rowNumber,
            id: null,
            first_name: base.first_name,
            last_name: base.last_name,
            flight: base.flight,
            handicap_index: base.handicap_index,
            preferences: base.preferences,
            photo_url: base.photo_url,
            changeType: "add",
            changes: [],
            errors,
          };
        }

        const existing = existingPlayers.get(base.id);
        if (!existing) {
          errors.push("Player ID not found in this tournament");
          return {
            rowNumber: base.rowNumber,
            id: base.id,
            first_name: base.first_name,
            last_name: base.last_name,
            flight: base.flight,
            handicap_index: base.handicap_index,
            preferences: base.preferences,
            photo_url: base.photo_url,
            changeType: "update",
            changes: [],
            errors,
          };
        }

        const changes: ImportCsvPreviewFieldChange[] = [];
        const compare = (
          field: ImportCsvPreviewFieldChange["field"],
          after: string | number | null,
          before: string | number | null,
        ) => {
          if (after !== before) changes.push({ field, before, after });
        };
        compare("first_name", base.first_name, existing.first_name);
        compare("last_name", base.last_name, existing.last_name);
        compare("flight", base.flight, existing.flight);
        compare("handicap_index", base.handicap_index, existing.handicap_index);
        compare("preferences", base.preferences, existing.preferences);
        compare("photo_url", base.photo_url, existing.photo_url);

        if (errors.length === 0 && changes.some((c) => c.field === "flight")) {
          const wasChampionship = isChampionship(
            existing.flight,
            tournament.championship_flight,
          );
          const willBeChampionship = isChampionship(
            base.flight,
            tournament.championship_flight,
          );
          if (wasChampionship !== willBeChampionship) {
            const entries = entriesByPlayerId.get(base.id) ?? [];
            // 'open', 'no_bid', and 'field' all mean zero bids were ever
            // placed (a 'field' entry was auto-swept there by the
            // silent-auction close job purely for having no bids at closing
            // time) — only 'reserved'/'sold_silent'/'sold_live' (or a set
            // placement, or an actual bid row) reflect real activity worth
            // protecting.
            const hasActivity = entries.some(
              (e) =>
                e.status === "reserved" || e.status === "sold_silent" ||
                e.status === "sold_live" || e.placement !== null ||
                entryIdsWithBids.has(e.id),
            );
            if (hasActivity) {
              errors.push(
                willBeChampionship
                  ? "Can't move into the Championship flight — this player already has bid activity"
                  : "Can't move out of the Championship flight — this player already has bid activity",
              );
            }
          }
        }

        return {
          rowNumber: base.rowNumber,
          id: base.id,
          first_name: base.first_name,
          last_name: base.last_name,
          flight: base.flight,
          handicap_index: base.handicap_index,
          preferences: base.preferences,
          photo_url: base.photo_url,
          changeType: changes.length > 0 ? "update" : "unchanged",
          changes,
          errors,
        };
      });

      return Response.json(
        {
          rows,
          validCount:
            rows.filter((r) =>
              r.errors.length === 0 && r.changeType !== "unchanged"
            )
              .length,
          errorCount: rows.filter((r) => r.errors.length > 0).length,
          addCount: rows.filter((r) => r.changeType === "add").length,
          updateCount: rows.filter((r) => r.changeType === "update").length,
          unchangedCount:
            rows.filter((r) => r.changeType === "unchanged").length,
        } satisfies ImportCsvPreviewResponse,
      );
    },
  ),
};
