// Admin confirms, outside the app, that the pot actually paid out a
// placement winner's share (spec 4.8/93): "once an Admin has actually
// handed a winner their share (outside the app), they mark that Payout
// as paid." Same pattern as mark-bid-paid, opposite money direction —
// recording only, never touches money, never calls a payment API (spec
// 2, Non-Goals).
//
// Payout-scoped (keyed by payoutId, not playerId): unlike
// buyerMarkedPaidAt/By (which live on Player), markedPaidAt/By live
// directly on Payout per spec 5's data model — there's no analogous
// "wrong table" trap here since Payout is the only place this field
// exists.
//
// One-directional by design, same reasoning as mark-bid-paid: nothing in
// spec 4.8 describes an "unmark" flow. Re-invoking against an
// already-marked payout is rejected as a 400, not a silent no-op.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import type {
  MarkPayoutPaidRequest,
  MarkPayoutPaidResponse,
} from "../_shared/contracts/mark-payout-paid.ts";

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
        | Partial<MarkPayoutPaidRequest>
        | null;
      if (!body?.payoutId) {
        return Response.json({ error: "payoutId is required" }, {
          status: 400,
        });
      }

      const { data: payout, error: payoutError } = await ctx.supabaseAdmin
        .from("payouts")
        .select(
          "id, tournament_id, player_id, bidder_id, placement, amount, marked_paid_at",
        )
        .eq("id", body.payoutId)
        .maybeSingle();
      if (payoutError) {
        return Response.json({ error: payoutError.message }, {
          status: 500,
        });
      }
      if (!payout) {
        return Response.json({ error: "Payout not found" }, { status: 404 });
      }
      if (payout.marked_paid_at) {
        return Response.json(
          { error: "This payout is already marked paid" },
          { status: 400 },
        );
      }

      const now = new Date().toISOString();
      const { data: updatedPayout, error: updateError } = await ctx
        .supabaseAdmin
        .from("payouts")
        .update({
          marked_paid_at: now,
          marked_paid_by: ctx.userClaims!.id,
        })
        .eq("id", body.payoutId)
        .select("id, marked_paid_at, marked_paid_by")
        .single();
      if (updateError) {
        return Response.json({ error: updateError.message }, {
          status: 400,
        });
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: payout.tournament_id,
        player_id: payout.player_id,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "payout_marked_paid",
        entity_type: "Payout",
        entity_id: payout.id,
        before: { marked_paid_at: null },
        after: {
          marked_paid_at: updatedPayout.marked_paid_at,
          marked_paid_by: updatedPayout.marked_paid_by,
          placement: payout.placement,
          amount: payout.amount,
          bidder_id: payout.bidder_id,
        },
        ip,
        user_agent,
      });

      // marked_paid_at/by are typed nullable on the payouts table in
      // general, but this select immediately follows the update that set
      // both — the non-null assertions just reflect what the write above
      // guarantees, not an unchecked assumption.
      return Response.json(
        {
          payout: {
            id: updatedPayout.id,
            marked_paid_at: updatedPayout.marked_paid_at!,
            marked_paid_by: updatedPayout.marked_paid_by!,
          },
        } satisfies MarkPayoutPaidResponse,
      );
    },
  ),
};
