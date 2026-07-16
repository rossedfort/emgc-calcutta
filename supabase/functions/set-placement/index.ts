// Admin/Owner sets a tournament's full set of finishing placements in one
// call, which automatically computes the payout for each winning bidder —
// pot x placement percentage, no manual math (spec 4.8). Bulk/full-replace
// by design (see the contract file's header comment): the caller sends
// every placement it wants filled, and any payout_structure place left
// out is treated as intentionally vacant.
//
// This replaces an earlier single-player version of this function.
// Rebuilt as bulk for two reasons, both surfaced by real usage of the
// results-entry modal rather than anticipated up front: (1) the modal was
// making up to one Edge Function call per configured payout place just to
// save one screen's worth of results — real but avoidable network
// overhead; (2) reassigning an already-placed spot to a different player
// (e.g. correcting who actually finished 1st) hit the (tournament_id,
// placement) uniqueness constraint no matter what order the client fired
// its per-player calls in, since the old occupant was never vacated
// first. A single server-side call can see the full desired state at
// once and vacate-then-assign correctly; a sequence of independent
// client calls fundamentally can't, since each one only ever adjusts one
// row without seeing what the others are about to do.
//
// Payout.bidderId comes from the *winning bid's* bidder_id (the buyer
// who bought this player in the auction), not players.user_id (the
// player-competitor's own linked account, if any) — the original
// backlog's own callout for this task, since a Calcutta's whole premise
// is those are often different people.
//
// Pot is the sum of winning_bid_id-referenced bid amounts across every
// sold_silent/sold_live player in the tournament (spec 4.8), not just
// live-auction winners, and not scoped to already-placed players — the
// pot total is fixed once every player is sold, independent of how many
// have been placed so far, so recomputing it fresh on every call is both
// correct and cheap.
//
// Placement ties stay disallowed (players_tournament_id_placement_key,
// the original per-player version's migration) — checked here too via
// the "no duplicate placement in the payload" validation, so a
// same-request collision surfaces as a clear message rather than a raw
// constraint error.
//
// Reassigning a placement away from a player whose payout is already
// marked paid is blocked outright, not silently allowed — confirmed as
// the safer default (same reasoning as void-bid's void-after-payout
// block): clearing a placement deletes its Payout row, and there's no
// "unmark paid" flow anywhere in this app to recover that record if
// blocking turns out to be wrong for a given case. The whole batch is
// rejected (no partial application) if *any* requested change would
// clear an already-paid placement, checked before any writes happen.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import type {
  SetPlacementEntry,
  SetPlacementRequest,
  SetPlacementResponse,
  SetPlacementResultEntry,
} from "../_shared/contracts/set-placement.ts";

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
        | Partial<SetPlacementRequest>
        | null;
      if (!body?.tournamentId || !Array.isArray(body.placements)) {
        return Response.json(
          { error: "tournamentId and a placements array are required" },
          { status: 400 },
        );
      }
      const tournamentId = body.tournamentId;
      const placements = body.placements as SetPlacementEntry[];

      for (const entry of placements) {
        if (
          !entry?.playerId || !Number.isInteger(entry.placement) ||
          entry.placement <= 0
        ) {
          return Response.json(
            {
              error:
                "Each placement entry needs a playerId and a positive integer placement",
            },
            { status: 400 },
          );
        }
      }

      const playerIds = placements.map((p) => p.playerId);
      if (new Set(playerIds).size !== playerIds.length) {
        return Response.json(
          {
            error: "The same player was submitted for more than one placement",
          },
          { status: 400 },
        );
      }
      const placementNumbers = placements.map((p) => p.placement);
      if (new Set(placementNumbers).size !== placementNumbers.length) {
        return Response.json(
          {
            error: "The same placement was submitted for more than one player",
          },
          { status: 400 },
        );
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select("payout_structure")
        .eq("id", tournamentId)
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
      const payoutStructure = tournament.payout_structure as Record<
        string,
        number
      >;

      for (const entry of placements) {
        if (typeof payoutStructure[String(entry.placement)] !== "number") {
          return Response.json(
            {
              error:
                `No payout percentage configured for placement ${entry.placement}`,
            },
            { status: 400 },
          );
        }
      }

      // winning_bid:bids!players_winning_bid_id_fkey disambiguates the
      // embed the same way void-bid's own query does — players<->bids has
      // two FK paths (bids.player_id and players.winning_bid_id), so
      // PostgREST can't infer which one this embed means without the
      // hint.
      const { data: targetPlayers, error: targetPlayersError } = await ctx
        .supabaseAdmin
        .from("players")
        .select(
          "id, tournament_id, status, placement, winning_bid_id, winning_bid:bids!players_winning_bid_id_fkey(bidder_id)",
        )
        .in(
          "id",
          playerIds.length > 0
            ? playerIds
            : ["00000000-0000-0000-0000-000000000000"],
        );
      if (targetPlayersError) {
        return Response.json({ error: targetPlayersError.message }, {
          status: 500,
        });
      }
      const targetById = new Map((targetPlayers ?? []).map((p) => [p.id, p]));

      const { data: existingPayouts, error: existingPayoutsError } = await ctx
        .supabaseAdmin
        .from("payouts")
        .select("player_id, id, placement, pot_share, amount, calculated_at")
        .in(
          "player_id",
          playerIds.length > 0
            ? playerIds
            : ["00000000-0000-0000-0000-000000000000"],
        );
      if (existingPayoutsError) {
        return Response.json({ error: existingPayoutsError.message }, {
          status: 500,
        });
      }
      const existingPayoutByPlayerId = new Map(
        (existingPayouts ?? []).map((p) => [p.player_id, p]),
      );

      for (const entry of placements) {
        const player = targetById.get(entry.playerId);
        if (!player || player.tournament_id !== tournamentId) {
          return Response.json(
            { error: `Player ${entry.playerId} not found in this tournament` },
            { status: 404 },
          );
        }
        if (player.status !== "sold_silent" && player.status !== "sold_live") {
          return Response.json(
            { error: `${entry.playerId} has not sold and cannot be placed` },
            { status: 400 },
          );
        }
        if (!player.winning_bid_id || !player.winning_bid) {
          return Response.json(
            {
              error:
                `${entry.playerId} has no winning bid to compute a payout from`,
            },
            { status: 400 },
          );
        }
      }

      const { data: currentlyPlaced, error: currentlyPlacedError } = await ctx
        .supabaseAdmin
        .from("players")
        .select("id, placement")
        .eq("tournament_id", tournamentId)
        .not("placement", "is", null);
      if (currentlyPlacedError) {
        return Response.json({ error: currentlyPlacedError.message }, {
          status: 500,
        });
      }

      // A currently-placed player is cleared unless this submission
      // keeps *them specifically* on *their current* placement number —
      // moved to a different number, or their number handed to someone
      // else, or simply dropped, all resolve to "clear."
      const desiredByPlacement = new Map(
        placements.map((p) => [p.placement, p.playerId]),
      );
      const toClear = (currentlyPlaced ?? []).filter((p) =>
        desiredByPlacement.get(p.placement as number) !== p.id
      );

      if (toClear.length > 0) {
        const { data: clearPayouts, error: clearPayoutsError } = await ctx
          .supabaseAdmin
          .from("payouts")
          .select("player_id, placement, marked_paid_at")
          .in("player_id", toClear.map((p) => p.id));
        if (clearPayoutsError) {
          return Response.json({ error: clearPayoutsError.message }, {
            status: 500,
          });
        }

        const alreadyPaid = (clearPayouts ?? []).filter((p) =>
          p.marked_paid_at
        );
        if (alreadyPaid.length > 0) {
          const detail = alreadyPaid
            .map((p) => `placement ${p.placement}`)
            .join(", ");
          return Response.json(
            {
              error:
                `Cannot reassign: the payout for ${detail} is already marked paid. Resolve it manually before changing this result.`,
            },
            { status: 400 },
          );
        }
      }

      if (toClear.length > 0) {
        const { error: deletePayoutsError } = await ctx.supabaseAdmin
          .from("payouts")
          .delete()
          .in("player_id", toClear.map((p) => p.id));
        if (deletePayoutsError) {
          return Response.json({ error: deletePayoutsError.message }, {
            status: 500,
          });
        }

        const { error: clearPlacementError } = await ctx.supabaseAdmin
          .from("players")
          .update({ placement: null })
          .in("id", toClear.map((p) => p.id));
        if (clearPlacementError) {
          return Response.json({ error: clearPlacementError.message }, {
            status: 500,
          });
        }
      }

      const { data: soldPlayers, error: soldPlayersError } = await ctx
        .supabaseAdmin
        .from("players")
        .select("winning_bid:bids!players_winning_bid_id_fkey(amount)")
        .eq("tournament_id", tournamentId)
        .in("status", ["sold_silent", "sold_live"]);
      if (soldPlayersError) {
        return Response.json({ error: soldPlayersError.message }, {
          status: 500,
        });
      }
      const pot = (soldPlayers ?? []).reduce(
        (sum, p) => sum + (p.winning_bid?.amount ?? 0),
        0,
      );

      const { ip, user_agent } = requestMetadata(req);
      const results: SetPlacementResultEntry[] = [];

      for (const entry of placements) {
        const player = targetById.get(entry.playerId)!;

        // Unchanged from what's already persisted — skip the write and
        // the audit event entirely rather than re-upserting the same
        // values. The modal always submits the full form state, so most
        // entries in a typical edit are untouched; without this check
        // every save would log a placement_set for every configured
        // place, not just the ones actually being changed.
        if (player.placement === entry.placement) {
          const existing = existingPayoutByPlayerId.get(entry.playerId);
          if (existing) {
            results.push({
              playerId: entry.playerId,
              placement: existing.placement,
              payout: {
                id: existing.id,
                pot_share: existing.pot_share,
                amount: existing.amount,
                calculated_at: existing.calculated_at,
              },
            });
            continue;
          }
        }

        const potShare = payoutStructure[String(entry.placement)];
        const amount = Math.round(pot * potShare * 100) / 100;

        const { data: payout, error: payoutError } = await ctx.supabaseAdmin
          .from("payouts")
          .upsert(
            {
              tournament_id: tournamentId,
              player_id: entry.playerId,
              bidder_id: player.winning_bid!.bidder_id,
              placement: entry.placement,
              pot_share: potShare,
              amount,
              calculated_at: new Date().toISOString(),
            },
            { onConflict: "player_id" },
          )
          .select("id, placement, pot_share, amount, calculated_at")
          .single();
        if (payoutError) {
          return Response.json({ error: payoutError.message }, {
            status: 400,
          });
        }

        const { error: updatePlayerError } = await ctx.supabaseAdmin
          .from("players")
          .update({ placement: entry.placement })
          .eq("id", entry.playerId);
        if (updatePlayerError) {
          return Response.json({ error: updatePlayerError.message }, {
            status: 400,
          });
        }

        await logAuditEvent(ctx.supabaseAdmin, {
          tournament_id: tournamentId,
          player_id: entry.playerId,
          actor_id: ctx.userClaims!.id,
          actor_identity: ctx.userClaims?.email ?? null,
          action: "placement_set",
          entity_type: "Player",
          entity_id: entry.playerId,
          before: { placement: player.placement },
          after: {
            placement: entry.placement,
            payout_id: payout.id,
            pot_share: payout.pot_share,
            amount: payout.amount,
          },
          ip,
          user_agent,
        });

        results.push({
          playerId: entry.playerId,
          placement: payout.placement,
          payout: {
            id: payout.id,
            pot_share: payout.pot_share,
            amount: payout.amount,
            calculated_at: payout.calculated_at,
          },
        });
      }

      for (const cleared of toClear) {
        await logAuditEvent(ctx.supabaseAdmin, {
          tournament_id: tournamentId,
          player_id: cleared.id,
          actor_id: ctx.userClaims!.id,
          actor_identity: ctx.userClaims?.email ?? null,
          action: "placement_cleared",
          entity_type: "Player",
          entity_id: cleared.id,
          before: { placement: cleared.placement },
          after: { placement: null },
          ip,
          user_agent,
        });
      }

      return Response.json(
        {
          results,
          cleared: toClear.map((p) => p.id),
        } satisfies SetPlacementResponse,
      );
    },
  ),
};
