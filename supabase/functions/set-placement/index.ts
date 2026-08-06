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
// Phase 20 ("the field"): a swept (status = 'field') entry has no winning
// bid of its own — it was pooled into a group's field lot instead of ever
// being individually sold — so its bidderId is resolved one hop through
// field_entry_id's own winning bid instead. Multiple swept players placing
// under the same field lot each still get their own Payout row (keyed on
// their own entry_id), all crediting the same buyer; no special-casing
// needed beyond that resolution, same upsert-per-entry shape as always. A
// field lot itself is never directly placeable (it has no real golf score)
// and is excluded outright via players.is_field.
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
import {
  type AcceptedBuyback,
  computeEntryPayoutRows,
  computePotByGroup,
  potGroupKey,
} from "../_shared/payouts.ts";
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
          "id, player_id, tournament_id, flight, division, status, placement, winning_bid_id, field_entry_id, players(is_field), winning_bid:bids!player_entries_winning_bid_id_fkey(bidder_id)",
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
        .select(
          "entry_id, id, bidder_id, placement, pot_share, amount, calculated_at",
        )
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
      // A split entry (Phase 14) has two rows sharing an entry_id, so this
      // groups rather than assuming one row per entry the way a plain Map
      // keyed on entry_id would.
      const existingPayoutsByEntryId = new Map<
        string,
        typeof existingPayouts
      >();
      for (const p of existingPayouts ?? []) {
        const list = existingPayoutsByEntryId.get(p.entry_id) ?? [];
        list.push(p);
        existingPayoutsByEntryId.set(p.entry_id, list);
      }

      // Accepted stake_buybacks (Phase 14) for the targeted entries,
      // fetched once up front rather than per-entry inside the loop below
      // — an entry with an accepted buy-back gets its computed payout
      // split across the buyer and the golfer instead of one row.
      const { data: acceptedBuybacks, error: buybacksError } = await ctx
        .supabaseAdmin
        .from("stake_buybacks")
        .select("id, entry_id, requester_id, percentage")
        .eq("status", "accepted")
        .in(
          "entry_id",
          entryIds.length > 0
            ? entryIds
            : ["00000000-0000-0000-0000-000000000000"],
        );
      if (buybacksError) {
        return Response.json({ error: buybacksError.message }, {
          status: 500,
        });
      }
      const acceptedBuybackByEntryId = new Map<string, AcceptedBuyback>(
        (acceptedBuybacks ?? []).map((b) => [b.entry_id, b]),
      );

      // Field lots (Phase 20) targeted by any swept entry above, fetched as
      // a second round trip rather than embedded on targetEntries directly
      // — confirmed directly against PostgREST that a self-referencing FK
      // hint (player_entries.field_entry_id -> player_entries.id) only
      // ever resolves the reverse direction ("rows that point at me") no
      // matter which embed hint syntax is used, never the forward
      // direction ("the one row I point at") a swept entry actually needs.
      const fieldEntryIds = [
        ...new Set(
          (targetEntries ?? [])
            .filter((t) => t.status === "field" && t.field_entry_id)
            .map((t) => t.field_entry_id as string),
        ),
      ];
      const { data: fieldEntries, error: fieldEntriesError } = await ctx
        .supabaseAdmin
        .from("player_entries")
        .select(
          "id, winning_bid_id, winning_bid:bids!player_entries_winning_bid_id_fkey(bidder_id)",
        )
        .in(
          "id",
          fieldEntryIds.length > 0
            ? fieldEntryIds
            : ["00000000-0000-0000-0000-000000000000"],
        );
      if (fieldEntriesError) {
        return Response.json({ error: fieldEntriesError.message }, {
          status: 500,
        });
      }
      const fieldEntryById = new Map(
        (fieldEntries ?? []).map((fe) => [fe.id, fe]),
      );

      // Resolved once here, not re-derived inline later — a swept
      // (status = 'field') entry's payout is credited to its field lot's
      // winning bidder (Phase 20: "if any pooled player then finishes in a
      // paid placement, the field's buyer collects that payout, same as
      // if they'd bought that player outright"), not to any bid of its
      // own (it never received one).
      const bidderIdByEntryId = new Map<string, string>();

      for (const entry of placements) {
        const target = targetById.get(entry.entryId);
        if (!target || target.tournament_id !== tournamentId) {
          return Response.json(
            { error: `Player ${entry.entryId} not found in this tournament` },
            { status: 404 },
          );
        }
        if (target.players?.is_field) {
          return Response.json(
            {
              error:
                `${entry.entryId} is a field lot and cannot be placed directly — place the individual players pooled into it instead`,
            },
            { status: 400 },
          );
        }
        if (
          target.status !== "sold_silent" && target.status !== "sold_live" &&
          target.status !== "field"
        ) {
          return Response.json(
            { error: `${entry.entryId} has not sold and cannot be placed` },
            { status: 400 },
          );
        }
        if (target.status === "field") {
          const fieldEntry = target.field_entry_id
            ? fieldEntryById.get(target.field_entry_id)
            : undefined;
          if (!fieldEntry?.winning_bid_id || !fieldEntry.winning_bid) {
            return Response.json(
              {
                error:
                  `${entry.entryId}'s field lot has not sold yet, so its players cannot be placed`,
              },
              { status: 400 },
            );
          }
          bidderIdByEntryId.set(
            entry.entryId,
            fieldEntry.winning_bid.bidder_id,
          );
        } else {
          if (!target.winning_bid_id || !target.winning_bid) {
            return Response.json(
              {
                error:
                  `${entry.entryId} has no winning bid to compute a payout from`,
              },
              { status: 400 },
            );
          }
          bidderIdByEntryId.set(entry.entryId, target.winning_bid.bidder_id);
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
      const potByGroupResult = await computePotByGroup(
        ctx.supabaseAdmin,
        tournamentId,
      );
      if (potByGroupResult.potByGroup === null) {
        return Response.json({ error: potByGroupResult.error }, {
          status: 500,
        });
      }
      const { potByGroup } = potByGroupResult;

      const { ip, user_agent } = requestMetadata(req);
      const results: SetPlacementResultEntry[] = [];

      for (const entry of placements) {
        const target = targetById.get(entry.entryId)!;

        // Unchanged from what's already persisted — skip the write and
        // the audit event entirely rather than re-upserting the same
        // values. The modal always submits the full form state, so most
        // entries in a typical edit are untouched; without this check
        // every save would log a placement_set for every configured
        // place, not just the ones actually being changed. A split entry
        // (Phase 14) has already been kept correct by whichever of
        // set-placement's own last run or respond-stake-buyback's own
        // accept-triggered recompute wrote it last — nothing about an
        // accepted buy-back changes after acceptance, so there's nothing
        // to re-derive here even for a split entry.
        if (target.placement === entry.placement) {
          const existing = existingPayoutsByEntryId.get(entry.entryId);
          if (existing && existing.length > 0) {
            results.push({
              entryId: entry.entryId,
              placement: existing[0].placement,
              payouts: existing.map((p) => ({
                id: p.id,
                bidder_id: p.bidder_id,
                pot_share: p.pot_share,
                amount: p.amount,
                calculated_at: p.calculated_at,
              })),
            });
            continue;
          }
        }

        const potShare = payoutStructure[String(entry.placement)];
        const pot = potByGroup.get(
          potGroupKey(target.flight, target.division),
        ) ?? 0;
        const rows = computeEntryPayoutRows({
          tournamentId,
          entryId: entry.entryId,
          bidderId: bidderIdByEntryId.get(entry.entryId)!,
          placement: entry.placement,
          potShare,
          pot,
          acceptedBuyback: acceptedBuybackByEntryId.get(entry.entryId) ??
            null,
        });

        const savedPayouts: {
          id: string;
          bidder_id: string;
          pot_share: number;
          amount: number;
          calculated_at: string;
        }[] = [];
        for (const row of rows) {
          const { data: payout, error: payoutError } = await ctx
            .supabaseAdmin
            .from("payouts")
            .upsert(row, { onConflict: "entry_id,bidder_id" })
            .select(
              "id, bidder_id, placement, pot_share, amount, calculated_at",
            )
            .single();
          if (payoutError) {
            return Response.json({ error: payoutError.message }, {
              status: 400,
            });
          }
          savedPayouts.push(payout);
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
            payouts: savedPayouts.map((p) => ({
              payout_id: p.id,
              bidder_id: p.bidder_id,
              pot_share: p.pot_share,
              amount: p.amount,
            })),
          },
          ip,
          user_agent,
        });

        results.push({
          entryId: entry.entryId,
          placement: entry.placement,
          payouts: savedPayouts.map((p) => ({
            id: p.id,
            bidder_id: p.bidder_id,
            pot_share: p.pot_share,
            amount: p.amount,
            calculated_at: p.calculated_at,
          })),
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
