// The winning bidder accepts or rejects a golfer's stake buy-back request
// (Phase 14). Self-service, not an Admin action: the caller must be the
// stake_buybacks row's own buyer_id — the "Accept"/"Reject" actions
// alongside "What you owe" on /me/balance.
//
// Rejecting is a plain status flip — nothing else to do, since accepting
// never happened. Accepting is the interesting case: if the entry hasn't
// been placed yet (player_entries.placement is still null), there's
// nothing to recompute — set-placement already checks for an accepted
// stake_buybacks row on every entry it places (see _shared/payouts.ts),
// so whenever results *are* entered, the split happens automatically. But
// a buy-back can be accepted *after* set-placement already ran for this
// entry (the response action isn't time-gated the way the request button
// is, unlike tournaments.event_start_at) — in that case a Payout may
// already exist as a single row owed entirely to the buyer, and this
// function has to redo that one entry's payout math itself, split-aware,
// right now. Blocked outright (same reasoning as set-placement's
// clearing block and void-bid's void-after-payout block) if the existing
// payout is already marked paid — there's no "unmark paid" flow anywhere
// in this app to recover from an incorrect split after the fact.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import {
  computeEntryPayoutRows,
  computePotByGroup,
  potGroupKey,
} from "../_shared/payouts.ts";
import type { Database } from "../_shared/database.ts";
import type {
  RespondStakeBuybackRequest,
  RespondStakeBuybackResponse,
} from "../_shared/contracts/respond-stake-buyback.ts";

interface SavedPayoutRow {
  id: string;
  bidder_id: string;
  pot_share: number;
  amount: number;
  calculated_at: string;
}

export default {
  fetch: withSupabase<Database>(
    { auth: "user", env: resolveSupabaseEnv() },
    async (req, ctx) => {
      const body = await req.json().catch(() => null) as
        | Partial<RespondStakeBuybackRequest>
        | null;
      if (
        !body?.entryId ||
        (body.decision !== "accept" && body.decision !== "reject")
      ) {
        return Response.json(
          {
            error:
              "entryId and a decision of 'accept' or 'reject' are required",
          },
          { status: 400 },
        );
      }

      const { data: stakeBuyback, error: stakeBuybackError } = await ctx
        .supabaseAdmin
        .from("stake_buybacks")
        .select(
          "id, tournament_id, entry_id, requester_id, buyer_id, percentage, status",
        )
        .eq("entry_id", body.entryId)
        .maybeSingle();
      if (stakeBuybackError) {
        return Response.json({ error: stakeBuybackError.message }, {
          status: 500,
        });
      }
      if (!stakeBuyback) {
        return Response.json(
          { error: "No buy-back request found for this player" },
          { status: 404 },
        );
      }
      if (stakeBuyback.buyer_id !== ctx.userClaims!.id) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      if (stakeBuyback.status !== "pending") {
        return Response.json(
          { error: `This request has already been ${stakeBuyback.status}` },
          { status: 400 },
        );
      }

      // Needed regardless of decision: player_id for the audit event
      // (always the golfer's own players.id, matching this codebase's
      // established convention), and — only for an accept on an
      // already-placed entry — flight/division/placement/winning_bid to
      // recompute the split.
      const { data: entry, error: entryError } = await ctx.supabaseAdmin
        .from("player_entries")
        .select(
          "id, tournament_id, player_id, flight, division, placement, winning_bid:bids!player_entries_winning_bid_id_fkey(bidder_id)",
        )
        .eq("id", body.entryId)
        .maybeSingle();
      if (entryError) {
        return Response.json({ error: entryError.message }, { status: 500 });
      }
      if (!entry) {
        return Response.json({ error: "Player not found" }, { status: 404 });
      }

      const newStatus = body.decision === "accept" ? "accepted" : "rejected";
      let payoutRows: SavedPayoutRow[] | null = null;

      if (body.decision === "accept" && entry.placement !== null) {
        const { data: existingPayouts, error: existingPayoutsError } = await ctx
          .supabaseAdmin
          .from("payouts")
          .select("id, marked_paid_at")
          .eq("entry_id", body.entryId);
        if (existingPayoutsError) {
          return Response.json({ error: existingPayoutsError.message }, {
            status: 500,
          });
        }
        if ((existingPayouts ?? []).some((p) => p.marked_paid_at)) {
          return Response.json(
            {
              error:
                "Cannot accept: the payout for this player is already marked paid. Resolve it manually before accepting this buy-back.",
            },
            { status: 400 },
          );
        }

        const { data: tournament, error: tournamentError } = await ctx
          .supabaseAdmin
          .from("tournaments")
          .select("payout_structure")
          .eq("id", entry.tournament_id)
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
        const potShare = payoutStructure[String(entry.placement)];
        if (typeof potShare !== "number") {
          return Response.json(
            {
              error:
                `No payout percentage configured for placement ${entry.placement}`,
            },
            { status: 400 },
          );
        }

        const potByGroupResult = await computePotByGroup(
          ctx.supabaseAdmin,
          entry.tournament_id,
        );
        if (potByGroupResult.potByGroup === null) {
          return Response.json({ error: potByGroupResult.error }, {
            status: 500,
          });
        }
        const pot = potByGroupResult.potByGroup.get(
          potGroupKey(entry.flight, entry.division),
        ) ?? 0;

        const rows = computeEntryPayoutRows({
          tournamentId: entry.tournament_id,
          entryId: body.entryId,
          bidderId: entry.winning_bid!.bidder_id,
          placement: entry.placement,
          potShare,
          pot,
          acceptedBuyback: {
            id: stakeBuyback.id,
            requester_id: stakeBuyback.requester_id,
            percentage: stakeBuyback.percentage,
          },
        });

        const saved: SavedPayoutRow[] = [];
        for (const row of rows) {
          const { data: payout, error: payoutError } = await ctx
            .supabaseAdmin
            .from("payouts")
            .upsert(row, { onConflict: "entry_id,bidder_id" })
            .select("id, bidder_id, pot_share, amount, calculated_at")
            .single();
          if (payoutError) {
            return Response.json({ error: payoutError.message }, {
              status: 400,
            });
          }
          saved.push(payout);
        }
        payoutRows = saved;
      }

      const { data: updated, error: updateError } = await ctx.supabaseAdmin
        .from("stake_buybacks")
        .update({
          status: newStatus,
          responded_at: new Date().toISOString(),
          responded_by: ctx.userClaims!.id,
        })
        .eq("id", stakeBuyback.id)
        .select("id, status")
        .single();
      if (updateError) {
        return Response.json({ error: updateError.message }, {
          status: 400,
        });
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: stakeBuyback.tournament_id,
        player_id: entry.player_id,
        entry_id: body.entryId,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: newStatus === "accepted"
          ? "stake_buyback_accepted"
          : "stake_buyback_rejected",
        entity_type: "PlayerEntry",
        entity_id: body.entryId,
        after: {
          stake_buyback_id: stakeBuyback.id,
          status: newStatus,
          payouts: payoutRows?.map((p) => ({
            id: p.id,
            bidder_id: p.bidder_id,
            pot_share: p.pot_share,
            amount: p.amount,
          })) ?? null,
        },
        ip,
        user_agent,
      });

      return Response.json(
        {
          stakeBuyback: {
            id: updated.id,
            status: updated.status as "accepted" | "rejected",
          },
          payouts: payoutRows,
        } satisfies RespondStakeBuybackResponse,
      );
    },
  ),
};
