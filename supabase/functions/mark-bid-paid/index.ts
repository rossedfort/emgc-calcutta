// Admin confirms, outside the app, that a winning bidder settled their
// side of a sold Player (spec 4.8/89-90): "the sum of their winning bid
// amounts... minus whichever of those bids an Admin has already marked
// 'paid'." Recording only — this never touches money, never calls a
// payment API (spec 2, Non-Goals).
//
// Deliberately Player-scoped, not Bid-scoped, even though the field
// being set describes "a winning bid's paid status": per spec 5's data
// model, buyerMarkedPaidAt/buyerMarkedPaidBy live on Player, not Bid —
// Bid itself never gets a paid marker (see the backlog's own callout for
// this task, added specifically to head off building this against the
// wrong table).
//
// One-directional by design: nothing in spec 4.8 describes an "unmark"
// flow, unlike void-bid's explicit reversibility-by-an-Owner language for
// voids. Re-invoking against an already-marked player is rejected as a
// 400, the same "no silent no-op" shape void-bid uses for an
// already-voided bid.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import type {
  MarkBidPaidRequest,
  MarkBidPaidResponse,
} from "../_shared/contracts/mark-bid-paid.ts";

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
        | Partial<MarkBidPaidRequest>
        | null;
      if (!body?.playerId) {
        return Response.json({ error: "playerId is required" }, {
          status: 400,
        });
      }

      // winning_bid:bids!players_winning_bid_id_fkey disambiguates the
      // embed the same way void-bid's players!bids_player_id_fkey does
      // in the other direction — players<->bids now has two FK paths
      // (bids.player_id and players.winning_bid_id), so PostgREST can't
      // infer which one this embed means without the hint.
      const { data: player, error: playerError } = await ctx.supabaseAdmin
        .from("players")
        .select(
          "id, tournament_id, status, winning_bid_id, buyer_marked_paid_at, winning_bid:bids!players_winning_bid_id_fkey(amount, bidder_id)",
        )
        .eq("id", body.playerId)
        .maybeSingle();
      if (playerError) {
        return Response.json({ error: playerError.message }, {
          status: 500,
        });
      }
      if (!player) {
        return Response.json({ error: "Player not found" }, { status: 404 });
      }
      if (!player.winning_bid_id) {
        return Response.json(
          { error: "This player has no winning bid to mark paid" },
          { status: 400 },
        );
      }
      if (player.buyer_marked_paid_at) {
        return Response.json(
          { error: "This bid is already marked paid" },
          { status: 400 },
        );
      }

      const now = new Date().toISOString();
      const { data: updatedPlayer, error: updateError } = await ctx
        .supabaseAdmin
        .from("players")
        .update({
          buyer_marked_paid_at: now,
          buyer_marked_paid_by: ctx.userClaims!.id,
        })
        .eq("id", body.playerId)
        .select("id, buyer_marked_paid_at, buyer_marked_paid_by")
        .single();
      if (updateError) {
        return Response.json({ error: updateError.message }, {
          status: 400,
        });
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: player.tournament_id,
        player_id: player.id,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "bid_marked_paid",
        entity_type: "Player",
        entity_id: player.id,
        before: { buyer_marked_paid_at: null },
        after: {
          buyer_marked_paid_at: updatedPlayer.buyer_marked_paid_at,
          buyer_marked_paid_by: updatedPlayer.buyer_marked_paid_by,
          winning_bid_id: player.winning_bid_id,
          amount: player.winning_bid?.amount ?? null,
          bidder_id: player.winning_bid?.bidder_id ?? null,
        },
        ip,
        user_agent,
      });

      // buyer_marked_paid_at/by are typed nullable on the players table in
      // general, but this select immediately follows the update that set
      // both — the non-null assertions just reflect what the write above
      // guarantees, not an unchecked assumption.
      return Response.json(
        {
          player: {
            id: updatedPlayer.id,
            buyer_marked_paid_at: updatedPlayer.buyer_marked_paid_at!,
            buyer_marked_paid_by: updatedPlayer.buyer_marked_paid_by!,
          },
        } satisfies MarkBidPaidResponse,
      );
    },
  ),
};
