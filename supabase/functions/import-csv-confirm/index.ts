// Writes the rows an Admin has reviewed and confirmed from the
// import-csv-preview payload — this is the commit step (spec 4.2). A row
// with no `id` is a brand-new player, written unlinked (self-service
// linking, Phase 10, is the only way a Player gets connected to a User). A
// row with an `id` updates that existing player in place instead — this is
// the upsert half of the feature: an Admin exports the roster (see
// players/export), hand-edits it, and re-uploads to both add and update in
// one pass.
//
// Two insert statements for new rows (Phase 11), not one: first the
// `players` identity rows (one per CSV row, in order — Postgres preserves
// row order through a plain VALUES-list INSERT...RETURNING, which the code
// below relies on to line each returned player back up with its own row's
// flight/division), then a `flatMap`'d `player_entries` insert (one row, or
// two for a Championship-flight golfer). Each insert is still atomic on its
// own (a single multi-row INSERT either fully succeeds or fully rolls
// back), but the two together no longer share one transaction the way a
// single insert did — if the `player_entries` insert fails after the
// `players` insert already committed, that would silently leave identity
// rows with zero sellable entries (invisible everywhere entries are
// required, effectively a phantom golfer no one could ever bid on). Rather
// than reach for a Postgres function purely to restore atomicity, the
// `players` rows just inserted are explicitly deleted before returning the
// error — a compensating rollback, not a real transaction, but sufficient
// here since the only realistic failure mode at that second step is
// transient (network/connection), not a data problem: the division on
// every entry row is derived from the exact same
// `tournament.championship_flight` comparison already used for the
// `players` insert, so if that insert succeeded, the entries insert's data
// is already known-valid.
//
// Update rows are a different shape of risk: each one is independent of
// every other row (unlike the new-row insert, which is genuinely one
// all-or-nothing batch), so they're applied one at a time and a single
// row's failure (the player was deleted since preview, or picked up bid
// activity in the meantime) is collected into `rowErrors` and skipped
// rather than discarding every other row's already-successful update. A
// row whose flight edit crosses into or out of the tournament's
// Championship flight needs its player_entries row(s) split into a
// Gross+Net pair (or merged back into one 'overall' entry) exactly like
// the single-player edit form's own updateDetails action — see that
// action's comments for the fuller reasoning; mirrored here rather than
// shared, since apps/web and supabase/functions are separate toolchains
// with no shared runtime code path today (only shared *types*, via
// packages/shared-types).
//
// Logs one AuditEvent for the whole batch (Phase 5's review pass), not one
// per row — this is a single admin action even though it writes many rows,
// and a summary event (with every added/updated player's id, plus each
// update's before/after) is more useful for dispute resolution than N
// near-identical log lines.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database, Json } from "../_shared/database.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import type {
  ImportCsvConfirmRequest,
  ImportCsvConfirmResponse,
  ImportCsvConfirmRowError,
} from "../_shared/contracts/import-csv-confirm.ts";

function isChampionship(
  flight: string,
  championshipFlight: string | null,
): boolean {
  return !!championshipFlight && flight === championshipFlight;
}

interface UpdateOutcome {
  player?: { id: string; slug: string; first_name: string; last_name: string };
  before?: Json;
  after?: Json;
  error?: ImportCsvConfirmRowError;
}

async function applyUpdateRow(
  supabaseAdmin: SupabaseClient<Database>,
  tournamentId: string,
  flights: string[],
  championshipFlight: string | null,
  row: {
    id: string;
    first_name?: string;
    last_name?: string;
    flight?: string | null;
    handicap_index?: number | null;
    preferences?: string | null;
    photo_url?: string | null;
  },
): Promise<UpdateOutcome> {
  const first_name = row.first_name?.trim();
  const last_name = row.last_name?.trim();
  if (!first_name || !last_name) {
    return { error: { id: row.id, error: "First and last name are required" } };
  }
  const flight = row.flight ?? "";
  if (flight && !flights.includes(flight)) {
    return {
      error: {
        id: row.id,
        error: `Flight "${flight}" is not configured for this tournament`,
      },
    };
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("players")
    .select("id, flight")
    .eq("tournament_id", tournamentId)
    .eq("id", row.id)
    .maybeSingle();
  if (existingError) {
    return { error: { id: row.id, error: existingError.message } };
  }
  if (!existing) {
    return {
      error: { id: row.id, error: "Player not found in this tournament" },
    };
  }

  const { data: entries, error: entriesError } = await supabaseAdmin
    .from("player_entries")
    .select("id, division, status, placement")
    .eq("player_id", row.id);
  if (entriesError) {
    return { error: { id: row.id, error: entriesError.message } };
  }

  const entryIds = (entries ?? []).map((e) => e.id);
  // 'open', 'no_bid', and 'field' all mean zero bids were ever placed (a
  // 'field' entry was auto-swept there by the silent-auction close job
  // purely for having no bids at closing time) — only
  // 'reserved'/'sold_silent'/'sold_live' (or a set placement) reflect real
  // bid activity worth protecting.
  let hasActivity = (entries ?? []).some((e) =>
    e.status === "reserved" || e.status === "sold_silent" ||
    e.status === "sold_live" || e.placement !== null
  );
  if (!hasActivity && entryIds.length > 0) {
    const { count } = await supabaseAdmin
      .from("bids")
      .select("id", { count: "exact", head: true })
      .in("entry_id", entryIds);
    hasActivity = (count ?? 0) > 0;
  }

  const wasChampionship = isChampionship(existing.flight, championshipFlight);
  const willBeChampionship = isChampionship(flight, championshipFlight);

  if (wasChampionship !== willBeChampionship && hasActivity) {
    return {
      error: {
        id: row.id,
        error: willBeChampionship
          ? "Can't move into the Championship flight — this player already has bid activity"
          : "Can't move out of the Championship flight — this player already has bid activity",
      },
    };
  }

  if (wasChampionship !== willBeChampionship) {
    if (willBeChampionship) {
      const [entry] = entries ?? [];
      if (!entry) {
        return {
          error: { id: row.id, error: "Player has no entry to convert" },
        };
      }
      const { error: convertError } = await supabaseAdmin
        .from("player_entries")
        .update({ flight, division: "gross" })
        .eq("id", entry.id);
      if (convertError) {
        return { error: { id: row.id, error: convertError.message } };
      }
      const { error: insertError } = await supabaseAdmin.from("player_entries")
        .insert({
          player_id: row.id,
          tournament_id: tournamentId,
          flight,
          division: "net",
        });
      if (insertError) {
        await supabaseAdmin
          .from("player_entries")
          .update({ flight: existing.flight, division: "overall" })
          .eq("id", entry.id);
        return { error: { id: row.id, error: insertError.message } };
      }
    } else {
      const gross = (entries ?? []).find((e) => e.division === "gross");
      const net = (entries ?? []).find((e) => e.division === "net");
      if (!gross || !net) {
        return {
          error: {
            id: row.id,
            error: "Player is missing a Gross or Net entry",
          },
        };
      }
      const { error: deleteError } = await supabaseAdmin
        .from("player_entries")
        .delete()
        .eq("id", net.id);
      if (deleteError) {
        return { error: { id: row.id, error: deleteError.message } };
      }
      const { error: mergeError } = await supabaseAdmin
        .from("player_entries")
        .update({ flight, division: "overall" })
        .eq("id", gross.id);
      if (mergeError) {
        await supabaseAdmin.from("player_entries").insert({
          player_id: row.id,
          tournament_id: tournamentId,
          flight: existing.flight,
          division: "net",
          status: net.status,
          placement: net.placement,
        });
        return { error: { id: row.id, error: mergeError.message } };
      }
    }
  }

  const { data: before } = await supabaseAdmin
    .from("players")
    .select(
      "first_name, last_name, flight, handicap_index, preferences, photo_url",
    )
    .eq("id", row.id)
    .single();

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("players")
    .update({
      first_name,
      last_name,
      flight,
      handicap_index: row.handicap_index ?? null,
      preferences: row.preferences || null,
      photo_url: row.photo_url || null,
    })
    .eq("id", row.id)
    .select(
      "id, slug, first_name, last_name, flight, handicap_index, preferences, photo_url",
    )
    .single();
  if (updateError) return { error: { id: row.id, error: updateError.message } };

  return {
    player: {
      id: updated.id,
      slug: updated.slug,
      first_name: updated.first_name,
      last_name: updated.last_name,
    },
    before: (before ?? null) as Json,
    after: {
      first_name: updated.first_name,
      last_name: updated.last_name,
      flight: updated.flight,
      handicap_index: updated.handicap_index,
      preferences: updated.preferences,
      photo_url: updated.photo_url,
    } as Json,
  };
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
        | Partial<ImportCsvConfirmRequest>
        | null;
      if (!body?.tournamentId || !Array.isArray(body.rows)) {
        return Response.json(
          { error: "tournamentId and rows are required" },
          { status: 400 },
        );
      }
      if (body.rows.length === 0) {
        return Response.json({ error: "rows must not be empty" }, {
          status: 400,
        });
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

      const insertRows = body.rows.filter((row) => !row.id);
      const updateRows = body.rows.filter((
        row,
      ): row is typeof row & { id: string } => !!row.id);

      let insertedPlayers: {
        id: string;
        slug: string;
        first_name: string;
        last_name: string;
      }[] = [];
      let insertEntryCount = 0;

      if (insertRows.length > 0) {
        // Authoritative re-check, not just trusting the preview step's
        // client-visible validation (same reasoning as parseTournamentForm).
        const rowErrors: string[] = [];
        insertRows.forEach((row, index) => {
          if (!row.first_name?.trim()) {
            rowErrors.push(`Row ${index + 1}: first name is required`);
          }
          if (!row.last_name?.trim()) {
            rowErrors.push(`Row ${index + 1}: last name is required`);
          }
          if (row.flight && !tournament.flights.includes(row.flight)) {
            rowErrors.push(
              `Row ${index + 1}: flight "${row.flight}" is not configured`,
            );
          }
        });
        if (rowErrors.length > 0) {
          return Response.json({ error: rowErrors.join("; ") }, {
            status: 400,
          });
        }

        const insertPlayers = insertRows.map((row) => ({
          tournament_id: body.tournamentId!,
          first_name: row.first_name!.trim(),
          last_name: row.last_name!.trim(),
          // '' (not null) — players.flight is not-null-default-'' as of the
          // flighting schema task; a raw `|| null` here would violate that
          // constraint for any row with no flight in the CSV.
          flight: row.flight || "",
          handicap_index: row.handicap_index ?? null,
          preferences: row.preferences || null,
          photo_url: row.photo_url || null,
        }));

        const { data: players, error: insertError } = await ctx.supabaseAdmin
          .from("players")
          .insert(insertPlayers)
          .select("id, slug, first_name, last_name, flight");
        if (insertError) {
          return Response.json({ error: insertError.message }, {
            status: 400,
          });
        }

        // A roster row whose flight is the tournament's Championship flight
        // becomes *two* player_entries rows — one per division — since that
        // flight's golfers are auctioned separately for Gross and Net (Phase
        // 7.5, moved from `players` to `player_entries` in Phase 11). Every
        // other row stays a single 'overall' entry, unchanged.
        const insertEntries = players.flatMap((player) => {
          const base = {
            player_id: player.id,
            tournament_id: body.tournamentId!,
            flight: player.flight,
          };
          if (isChampionship(player.flight, tournament.championship_flight)) {
            return [
              { ...base, division: "gross" },
              { ...base, division: "net" },
            ];
          }
          return [{ ...base, division: "overall" }];
        });

        const { error: entriesInsertError } = await ctx.supabaseAdmin
          .from("player_entries")
          .insert(insertEntries);
        if (entriesInsertError) {
          // Compensating rollback — see the header comment for why this
          // isn't a real transaction. Best-effort: if the delete itself
          // fails too, the entriesInsertError is still what's surfaced to
          // the Admin, not this secondary failure.
          await ctx.supabaseAdmin.from("players").delete().in(
            "id",
            players.map((p) => p.id),
          );
          return Response.json({ error: entriesInsertError.message }, {
            status: 400,
          });
        }

        insertedPlayers = players;
        insertEntryCount = insertEntries.length;
      }

      const updatedPlayers: {
        id: string;
        slug: string;
        first_name: string;
        last_name: string;
      }[] = [];
      const updateAudits: { id: string; before?: Json; after?: Json }[] = [];
      const rowErrors: ImportCsvConfirmRowError[] = [];

      for (const row of updateRows) {
        const outcome = await applyUpdateRow(
          ctx.supabaseAdmin,
          body.tournamentId!,
          tournament.flights,
          tournament.championship_flight,
          row,
        );
        if (outcome.error) {
          rowErrors.push(outcome.error);
        } else if (outcome.player) {
          updatedPlayers.push(outcome.player);
          updateAudits.push({
            id: outcome.player.id,
            before: outcome.before,
            after: outcome.after,
          });
        }
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: body.tournamentId,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "csv_import",
        entity_type: "CSVImport",
        after: {
          addedCount: insertedPlayers.length,
          updatedCount: updatedPlayers.length,
          added: insertedPlayers.map((p) => ({
            id: p.id,
            slug: p.slug,
            first_name: p.first_name,
            last_name: p.last_name,
          })),
          addedEntryCount: insertEntryCount,
          updated: updateAudits,
          rowErrorCount: rowErrors.length,
        },
        ip,
        user_agent,
      });

      return Response.json(
        {
          addedCount: insertedPlayers.length,
          updatedCount: updatedPlayers.length,
          players: [
            ...insertedPlayers.map((p) => ({ ...p, action: "added" as const })),
            ...updatedPlayers.map((p) => ({
              ...p,
              action: "updated" as const,
            })),
          ],
          rowErrors,
        } satisfies ImportCsvConfirmResponse,
      );
    },
  ),
};
