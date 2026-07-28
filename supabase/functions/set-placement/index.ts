// Admin/Owner sets a tournament's full set of finishing placements in one
// call, which automatically computes the payout for each winning bidder —
// pot x placement percentage, no manual math (spec 4.8). Bulk/full-replace
// by design (see the contract file's header comment): the caller sends
// every placement it wants filled, and any payout_structure place left
// out is treated as intentionally vacant.
//
// Phase 7.5 (flighted results): placements, clearing, and pot are all
// scoped per (flight, division) group, not per tournament — a flighted
// tournament has one full 1st/2nd/3rd... per flight (and, for the
// Championship flight, per division within it), each with its own pot
// (confirmed decision: pot is per-flight/division, not one tournament-
// wide pot split across flights). `SetPlacementEntry` targets a
// `player_entries.id` (Phase 11, renamed from `playerId` to `entryId`) —
// flight/division aren't client-supplied, they're read off each targeted
// entry's own row (denormalized there since Phase 11), since an entry's
// flight/division is fixed once sold. This means two entries in the same
// request can legitimately share a placement number (Flight A's 1st and
// Flight B's 1st), so every uniqueness/clearing/pot computation below
// groups by (flight, division) instead of comparing placement numbers
// directly — the flat tournament-wide version of this logic would
// incorrectly collide unrelated flights' placements.
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
// sold_silent/sold_live player *in the same (flight, division) group*
// (spec 4.8 plus the Phase 7.5 per-group scoping above), not just
// live-auction winners, and not scoped to already-placed players — each
// group's pot total is fixed once every one of its players is sold,
// independent of how many have been placed so far, so recomputing it
// fresh on every call is both correct and cheap.
//
// Placement ties stay disallowed within a (flight, division) group
// (players_tournament_id_placement_key, now `(tournament_id, flight,
// division, placement)` as of the flighting schema task) — checked here
// too via the "no duplicate (flight, division, placement) in the
// payload" validation, so a same-request collision surfaces as a clear
// message rather than a raw constraint error.
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
          !entry?.entryId || !Number.isInteger(entry.placement) ||
          entry.placement <= 0
        ) {
          return Response.json(
            {
              error:
                "Each placement entry needs an entryId and a positive integer placement",
            },
            { status: 400 },
          );
        }
      }

      const entryIds = placements.map((p) => p.entryId);
      if (new Set(entryIds).size !== entryIds.length) {
        return Response.json(
          {
            error: "The same player was submitted for more than one placement",
          },
          { status: 400 },
        );
      }

      // (flight, division, placement) — not just placement — since two
      // entries can legitimately share a placement number as long as
      // they're in different flight/division groups. Checked again below
      // once each entry's player (and therefore flight/division) is
      // confirmed to exist.
      const groupKey = (flight: string, division: string, placement: number) =>
        JSON.stringify([flight, division, placement]);

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

      // winning_bid:bids!player_entries_winning_bid_id_fkey disambiguates
      // the embed the same way void-bid's own query does — player_entries
      // <->bids has two FK paths (bids.entry_id and
      // player_entries.winning_bid_id), so PostgREST can't infer which
      // one this embed means without the hint.
      const { data: targetEntries, error: targetEntriesError } = await ctx
        .supabaseAdmin
        .from("player_entries")
        .select(
          "id, player_id, tournament_id, flight, division, status, placement, winning_bid_id, winning_bid:bids!player_entries_winning_bid_id_fkey(bidder_id)",
        )
        .in(
          "id",
          entryIds.length > 0
            ? entryIds
            : ["00000000-0000-0000-0000-000000000000"],
        );
      if (targetEntriesError) {
        return Response.json({ error: targetEntriesError.message }, {
          status: 500,
        });
      }
      const targetById = new Map((targetEntries ?? []).map((p) => [p.id, p]));

      const { data: existingPayouts, error: existingPayoutsError } = await ctx
        .supabaseAdmin
        .from("payouts")
        .select("entry_id, id, placement, pot_share, amount, calculated_at")
        .in(
          "entry_id",
          entryIds.length > 0
            ? entryIds
            : ["00000000-0000-0000-0000-000000000000"],
        );
      if (existingPayoutsError) {
        return Response.json({ error: existingPayoutsError.message }, {
          status: 500,
        });
      }
      const existingPayoutByEntryId = new Map(
        (existingPayouts ?? []).map((p) => [p.entry_id, p]),
      );

      for (const entry of placements) {
        const target = targetById.get(entry.entryId);
        if (!target || target.tournament_id !== tournamentId) {
          return Response.json(
            { error: `Player ${entry.entryId} not found in this tournament` },
            { status: 404 },
          );
        }
        if (target.status !== "sold_silent" && target.status !== "sold_live") {
          return Response.json(
            { error: `${entry.entryId} has not sold and cannot be placed` },
            { status: 400 },
          );
        }
        if (!target.winning_bid_id || !target.winning_bid) {
          return Response.json(
            {
              error:
                `${entry.entryId} has no winning bid to compute a payout from`,
            },
            { status: 400 },
          );
        }
      }

      // Now that every entry's target row (and therefore flight/division)
      // is confirmed valid: two entries may share a placement number as
      // long as they're in different (flight, division) groups, but not
      // within the same one.
      const entryGroupKeys = placements.map((p) => {
        const target = targetById.get(p.entryId)!;
        return groupKey(target.flight, target.division, p.placement);
      });
      if (new Set(entryGroupKeys).size !== entryGroupKeys.length) {
        return Response.json(
          {
            error:
              "The same placement was submitted for more than one player within the same flight/division",
          },
          { status: 400 },
        );
      }

      const { data: currentlyPlaced, error: currentlyPlacedError } = await ctx
        .supabaseAdmin
        .from("player_entries")
        .select("id, player_id, flight, division, placement")
        .eq("tournament_id", tournamentId)
        .not("placement", "is", null);
      if (currentlyPlacedError) {
        return Response.json({ error: currentlyPlacedError.message }, {
          status: 500,
        });
      }

      // A currently-placed entry is cleared unless this submission keeps
      // *it specifically* on *its current* (flight, division,
      // placement) — moved to a different number, its spot handed to a
      // different entry *within the same flight/division*, or simply
      // dropped, all resolve to "clear." Keying by the group (not just
      // placement) is what keeps this scoped correctly: a request that
      // only touches Flight A must never clear Flight B's placement
      // holders just because they happen to share a placement number.
      const desiredByGroupPlacement = new Map(
        placements.map((p) => {
          const target = targetById.get(p.entryId)!;
          return [
            groupKey(target.flight, target.division, p.placement),
            p.entryId,
          ];
        }),
      );
      const toClear = (currentlyPlaced ?? []).filter((p) =>
        desiredByGroupPlacement.get(
          groupKey(p.flight, p.division, p.placement as number),
        ) !== p.id
      );

      if (toClear.length > 0) {
        const { data: clearPayouts, error: clearPayoutsError } = await ctx
          .supabaseAdmin
          .from("payouts")
          .select("entry_id, placement, marked_paid_at")
          .in("entry_id", toClear.map((p) => p.id));
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
          .in("entry_id", toClear.map((p) => p.id));
        if (deletePayoutsError) {
          return Response.json({ error: deletePayoutsError.message }, {
            status: 500,
          });
        }

        const { error: clearPlacementError } = await ctx.supabaseAdmin
          .from("player_entries")
          .update({ placement: null })
          .in("id", toClear.map((p) => p.id));
        if (clearPlacementError) {
          return Response.json({ error: clearPlacementError.message }, {
            status: 500,
          });
        }
      }

      // Pot per (flight, division) group, not one tournament-wide pot —
      // e.g. Flight A's pot is the sum of winning bids for Flight A's own
      // sold players only, independent of what Flight B raised. Every
      // ordinary flight has exactly one group (division always
      // 'overall'); the Championship flight has two ('gross' and 'net'),
      // each with its own separate pot, per the confirmed decision.
      const { data: soldEntries, error: soldEntriesError } = await ctx
        .supabaseAdmin
        .from("player_entries")
        .select(
          "flight, division, winning_bid:bids!player_entries_winning_bid_id_fkey(amount)",
        )
        .eq("tournament_id", tournamentId)
        .in("status", ["sold_silent", "sold_live"]);
      if (soldEntriesError) {
        return Response.json({ error: soldEntriesError.message }, {
          status: 500,
        });
      }
      const potByGroup = new Map<string, number>();
      for (const p of soldEntries ?? []) {
        const key = JSON.stringify([p.flight, p.division]);
        potByGroup.set(
          key,
          (potByGroup.get(key) ?? 0) + (p.winning_bid?.amount ?? 0),
        );
      }

      const { ip, user_agent } = requestMetadata(req);
      const results: SetPlacementResultEntry[] = [];

      for (const entry of placements) {
        const target = targetById.get(entry.entryId)!;

        // Unchanged from what's already persisted — skip the write and
        // the audit event entirely rather than re-upserting the same
        // values. The modal always submits the full form state, so most
        // entries in a typical edit are untouched; without this check
        // every save would log a placement_set for every configured
        // place, not just the ones actually being changed.
        if (target.placement === entry.placement) {
          const existing = existingPayoutByEntryId.get(entry.entryId);
          if (existing) {
            results.push({
              entryId: entry.entryId,
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
        const pot = potByGroup.get(
          JSON.stringify([target.flight, target.division]),
        ) ?? 0;
        const amount = Math.round(pot * potShare * 100) / 100;

        const { data: payout, error: payoutError } = await ctx.supabaseAdmin
          .from("payouts")
          .upsert(
            {
              tournament_id: tournamentId,
              entry_id: entry.entryId,
              bidder_id: target.winning_bid!.bidder_id,
              placement: entry.placement,
              pot_share: potShare,
              amount,
              calculated_at: new Date().toISOString(),
            },
            { onConflict: "entry_id" },
          )
          .select("id, placement, pot_share, amount, calculated_at")
          .single();
        if (payoutError) {
          return Response.json({ error: payoutError.message }, {
            status: 400,
          });
        }

        const { error: updateEntryError } = await ctx.supabaseAdmin
          .from("player_entries")
          .update({ placement: entry.placement })
          .eq("id", entry.entryId);
        if (updateEntryError) {
          return Response.json({ error: updateEntryError.message }, {
            status: 400,
          });
        }

        await logAuditEvent(ctx.supabaseAdmin, {
          tournament_id: tournamentId,
          player_id: target.player_id,
          entry_id: entry.entryId,
          actor_id: ctx.userClaims!.id,
          actor_identity: ctx.userClaims?.email ?? null,
          action: "placement_set",
          entity_type: "PlayerEntry",
          entity_id: entry.entryId,
          before: { placement: target.placement },
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
          entryId: entry.entryId,
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
          player_id: cleared.player_id,
          entry_id: cleared.id,
          actor_id: ctx.userClaims!.id,
          actor_identity: ctx.userClaims?.email ?? null,
          action: "placement_cleared",
          entity_type: "PlayerEntry",
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
