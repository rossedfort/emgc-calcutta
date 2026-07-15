// Admin voids a bid with a required reason (spec 7: voids are soft,
// logged, and reversible by an Owner — never a hard delete). Logs an
// AuditEvent (Phase 5's review pass) — the void-after-close recompute
// outcome, if any, rides along inside the same event's `after` payload
// rather than a second event, since the void is the one action a human
// took here; the recompute is a side effect of it, not a separate
// decision.
//
// Scope of the void-after-close recompute, confirmed with the user
// rather than assumed (the backlog explicitly flagged this as needing an
// explicit decision before building this): if the voided bid is the
// winning_bid_id of an already-closed live lot, this recomputes the
// winner from the next-highest surviving (non-voided) bid immediately —
// the lot stays closed, no further bidding happens, and the new "winner"
// is whoever had the next-highest bid at the time of the void. Every
// other case (voiding a bid that isn't a closed lot's winner, voiding a
// bid during still-open live bidding, voiding a silent bid that crossed
// the reservation threshold) is deliberately left untouched beyond the
// bid itself — those weren't part of the decision that was made, and
// place-bid's own high-bid lookup already excludes voided bids, so an
// open lot's "current high" self-corrects on the next bid with no
// immediate recompute needed here.
//
// The recompute also keeps players.winning_bid_id in sync (Phase 7) —
// not called out in that column's own backlog line (which only names
// close_silent_auctions/close_live_lot), but leaving it stale here would
// undermine the exact thing the column exists for: pot calculation needs
// it to reflect who *actually* won, and a void-triggered recompute is a
// real, already-reachable way for the two to drift apart.
//
// Blocks voiding a player's current winning bid once any Payout exists
// in the tournament (Phase 7, set-placement task) — confirmed with the
// user rather than assumed: the total pot (spec 4.8) is a tournament-wide
// sum across every sold player's winning bid, so voiding one after
// payouts have already been calculated would silently invalidate every
// other placed player's payout amount too, not just this bid's own
// player. Rather than cascade-recompute every existing Payout
// automatically, an Admin must correct or remove the affected payout(s)
// first — the void is rejected outright until then.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import type {
  VoidBidRequest,
  VoidBidResponse,
} from "../_shared/contracts/void-bid.ts";

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
        | Partial<VoidBidRequest>
        | null;
      if (!body?.bidId || !body.reason?.trim()) {
        return Response.json(
          { error: "bidId and a reason are required" },
          { status: 400 },
        );
      }

      // players!bids_player_id_fkey disambiguates the embed: Phase 7 added
      // players.winning_bid_id -> bids.id, a second FK path between these
      // two tables (the other direction from this one, bids.player_id ->
      // players.id) — PostgREST can no longer infer which relationship
      // this embed means without the hint, and fails the whole query with
      // "more than one relationship was found" instead of guessing wrong.
      const { data: bid, error: bidError } = await ctx.supabaseAdmin
        .from("bids")
        .select(
          "id, player_id, voided_at, amount, players!bids_player_id_fkey(tournament_id, winning_bid_id)",
        )
        .eq("id", body.bidId)
        .maybeSingle();
      if (bidError) {
        return Response.json({ error: bidError.message }, { status: 500 });
      }
      if (!bid) {
        return Response.json({ error: "Bid not found" }, { status: 404 });
      }
      if (bid.voided_at) {
        return Response.json({ error: "This bid is already voided" }, {
          status: 400,
        });
      }

      // See the header comment: once any Payout exists in this
      // tournament, voiding this player's current winning bid would
      // silently invalidate the tournament-wide pot every existing
      // Payout was calculated from — blocked outright rather than
      // cascade-recomputed.
      if (bid.players?.winning_bid_id === bid.id) {
        const { data: existingPayout, error: payoutCheckError } = await ctx
          .supabaseAdmin
          .from("payouts")
          .select("id")
          .eq("tournament_id", bid.players.tournament_id)
          .limit(1)
          .maybeSingle();
        if (payoutCheckError) {
          return Response.json({ error: payoutCheckError.message }, {
            status: 500,
          });
        }
        if (existingPayout) {
          return Response.json(
            {
              error:
                "Cannot void this bid: payouts have already been calculated for this tournament, and they depend on the total pot. Correct or remove the affected payout(s) first.",
            },
            { status: 400 },
          );
        }
      }

      const { data: voidedBid, error: voidError } = await ctx.supabaseAdmin
        .from("bids")
        .update({
          voided_at: new Date().toISOString(),
          void_reason: body.reason.trim(),
        })
        .eq("id", body.bidId)
        .select("id, voided_at, void_reason")
        .single();
      if (voidError) {
        return Response.json({ error: voidError.message }, { status: 400 });
      }

      // Was this the winning bid of an already-closed live lot? If so,
      // recompute the winner from the next-highest surviving bid — the
      // confirmed behavior for this case (see the header comment).
      const { data: affectedLot, error: lotError } = await ctx.supabaseAdmin
        .from("live_lots")
        .select("id")
        .eq("winning_bid_id", body.bidId)
        .not("closed_at", "is", null)
        .maybeSingle();
      if (lotError) {
        return Response.json({ error: lotError.message }, { status: 500 });
      }

      let recomputed = false;
      let newWinningBidId: string | null = null;
      if (affectedLot) {
        const { data: newHighBid, error: newHighBidError } = await ctx
          .supabaseAdmin
          .from("bids")
          .select("id")
          .eq("player_id", bid.player_id)
          .is("voided_at", null)
          .order("amount", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (newHighBidError) {
          return Response.json({ error: newHighBidError.message }, {
            status: 500,
          });
        }

        const { error: updateLotError } = await ctx.supabaseAdmin
          .from("live_lots")
          .update({ winning_bid_id: newHighBid?.id ?? null })
          .eq("id", affectedLot.id);
        if (updateLotError) {
          return Response.json({ error: updateLotError.message }, {
            status: 500,
          });
        }

        const { error: updatePlayerError } = await ctx.supabaseAdmin
          .from("players")
          .update({
            status: newHighBid ? "sold_live" : "no_bid",
            winning_bid_id: newHighBid?.id ?? null,
          })
          .eq("id", bid.player_id);
        if (updatePlayerError) {
          return Response.json({ error: updatePlayerError.message }, {
            status: 500,
          });
        }

        recomputed = true;
        newWinningBidId = newHighBid?.id ?? null;
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: bid.players?.tournament_id ?? null,
        player_id: bid.player_id,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "bid_voided",
        entity_type: "Bid",
        entity_id: bid.id,
        reason: body.reason.trim(),
        before: { voided_at: null, amount: bid.amount },
        after: {
          voided_at: voidedBid.voided_at,
          void_reason: voidedBid.void_reason,
          recomputed,
          new_winning_bid_id: newWinningBidId,
        },
        ip,
        user_agent,
      });

      // voided_at/void_reason are typed nullable on the bids table in
      // general, but this select immediately follows the update that set
      // both — the non-null assertions just reflect what the write above
      // guarantees, not an unchecked assumption.
      return Response.json(
        {
          bid: {
            id: voidedBid.id,
            voided_at: voidedBid.voided_at!,
            void_reason: voidedBid.void_reason!,
          },
          recomputed,
        } satisfies VoidBidResponse,
      );
    },
  ),
};
