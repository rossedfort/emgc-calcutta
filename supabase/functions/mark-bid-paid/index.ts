// Admin confirms, outside the app, that a winning bidder settled their
// side of a sold entry (spec 4.8/89-90): "the sum of their winning bid
// amounts... minus whichever of those bids an Admin has already marked
// 'paid'." Recording only — this never touches money, never calls a
// payment API (spec 2, Non-Goals).
//
// Deliberately PlayerEntry-scoped, not Bid-scoped, even though the field
// being set describes "a winning bid's paid status": per spec 5's data
// model (as of Phase 11), buyerMarkedPaidAt/buyerMarkedPaidBy live on
// PlayerEntry, not Bid — Bid itself never gets a paid marker (see the
// backlog's own callout for this task, added specifically to head off
// building this against the wrong table).
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
      if (!body?.entryId) {
        return Response.json({ error: "entryId is required" }, {
          status: 400,
        });
      }

      // winning_bid:bids!player_entries_winning_bid_id_fkey disambiguates
      // the embed the same way void-bid's own query does in the other
      // direction — player_entries<->bids has two FK paths
      // (bids.entry_id and player_entries.winning_bid_id), so PostgREST
      // can't infer which one this embed means without the hint.
      const { data: entry, error: entryError } = await ctx.supabaseAdmin
        .from("player_entries")
        .select(
          "id, player_id, tournament_id, status, winning_bid_id, buyer_marked_paid_at, winning_bid:bids!player_entries_winning_bid_id_fkey(amount, bidder_id)",
        )
        .eq("id", body.entryId)
        .maybeSingle();
      if (entryError) {
        return Response.json({ error: entryError.message }, {
          status: 500,
        });
      }
      if (!entry) {
        return Response.json({ error: "Player not found" }, { status: 404 });
      }
      if (!entry.winning_bid_id) {
        return Response.json(
          { error: "This player has no winning bid to mark paid" },
          { status: 400 },
        );
      }
      if (entry.buyer_marked_paid_at) {
        return Response.json(
          { error: "This bid is already marked paid" },
          { status: 400 },
        );
      }

      const now = new Date().toISOString();
      const { data: updatedEntry, error: updateError } = await ctx
        .supabaseAdmin
        .from("player_entries")
        .update({
          buyer_marked_paid_at: now,
          buyer_marked_paid_by: ctx.userClaims!.id,
        })
        .eq("id", body.entryId)
        .select("id, buyer_marked_paid_at, buyer_marked_paid_by")
        .single();
      if (updateError) {
        return Response.json({ error: updateError.message }, {
          status: 400,
        });
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: entry.tournament_id,
        player_id: entry.player_id,
        entry_id: entry.id,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "bid_marked_paid",
        entity_type: "PlayerEntry",
        entity_id: entry.id,
        before: { buyer_marked_paid_at: null },
        after: {
          buyer_marked_paid_at: updatedEntry.buyer_marked_paid_at,
          buyer_marked_paid_by: updatedEntry.buyer_marked_paid_by,
          winning_bid_id: entry.winning_bid_id,
          amount: entry.winning_bid?.amount ?? null,
          bidder_id: entry.winning_bid?.bidder_id ?? null,
        },
        ip,
        user_agent,
      });

      // buyer_marked_paid_at/by are typed nullable on player_entries in
      // general, but this select immediately follows the update that set
      // both — the non-null assertions just reflect what the write above
      // guarantees, not an unchecked assumption.
      return Response.json(
        {
          entry: {
            id: updatedEntry.id,
            buyer_marked_paid_at: updatedEntry.buyer_marked_paid_at!,
            buyer_marked_paid_by: updatedEntry.buyer_marked_paid_by!,
          },
        } satisfies MarkBidPaidResponse,
      );
    },
  ),
};
