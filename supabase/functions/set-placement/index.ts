// Admin/Owner sets a sold Player's finishing placement, which
// automatically computes the payout for that player's winning bidder —
// pot x placement percentage, no manual math (spec 4.8). Re-invokable:
// "recalculated (and re-logged) if a placement is corrected" is spec's
// own wording, so this upserts the Payout on (player_id) rather than
// rejecting a second call for an already-placed player.
//
// Payout.bidderId comes from the *winning bid's* bidder_id (the buyer
// who bought this player in the auction), not players.user_id (the
// player-competitor's own linked account, if any) — the backlog's own
// callout for this task, since a Calcutta's whole premise is those are
// often different people.
//
// Pot is the sum of winning_bid_id-referenced bid amounts across every
// sold_silent/sold_live player in the tournament (spec 4.8), not just
// live-auction winners, and not scoped to already-placed players — the
// pot total is fixed once every player is sold, independent of how many
// have been placed so far, so recomputing it fresh on every call is both
// correct and cheap.
//
// Two open questions the backlog flagged as needing an explicit decision
// before building this, not an implicit one in code — both confirmed
// with the user rather than assumed:
//
// 1. Ties: disallowed entirely. An Admin resolves a tie some other way
//    (e.g. a scorecard playoff) before entering results, rather than the
//    app splitting a placement's pot share across multiple players — see
//    the players_tournament_id_placement_key unique index (this same
//    migration set). Checked explicitly here too, ahead of that index,
//    so the rejection carries a clear message instead of a raw
//    constraint-violation error.
//
// 2. Voiding a winning bid after a Payout already exists off it: since
//    the pot is tournament-wide, this would silently invalidate every
//    placed player's payout, not just this one — void-bid now blocks
//    that outright once any Payout exists in the tournament, rather than
//    this function trying to detect and recover from a stale pot after
//    the fact.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import type {
  SetPlacementRequest,
  SetPlacementResponse,
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
      if (
        !body?.playerId || !Number.isInteger(body.placement) ||
        body.placement! <= 0
      ) {
        return Response.json(
          { error: "playerId and a positive integer placement are required" },
          { status: 400 },
        );
      }
      const placement = body.placement!;

      // winning_bid:bids!players_winning_bid_id_fkey disambiguates the
      // embed the same way void-bid's own query does — players<->bids
      // has two FK paths (bids.player_id and players.winning_bid_id), so
      // PostgREST can't infer which one this embed means without the
      // hint.
      const { data: player, error: playerError } = await ctx.supabaseAdmin
        .from("players")
        .select(
          "id, tournament_id, status, placement, winning_bid_id, winning_bid:bids!players_winning_bid_id_fkey(bidder_id)",
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
      if (player.status !== "sold_silent" && player.status !== "sold_live") {
        return Response.json(
          { error: "Only sold players can be placed" },
          { status: 400 },
        );
      }
      if (!player.winning_bid_id || !player.winning_bid) {
        return Response.json(
          { error: "This player has no winning bid to compute a payout from" },
          { status: 400 },
        );
      }

      const { data: placementConflict, error: conflictError } = await ctx
        .supabaseAdmin
        .from("players")
        .select("id")
        .eq("tournament_id", player.tournament_id)
        .eq("placement", placement)
        .neq("id", player.id)
        .maybeSingle();
      if (conflictError) {
        return Response.json({ error: conflictError.message }, {
          status: 500,
        });
      }
      if (placementConflict) {
        return Response.json(
          {
            error:
              "That placement is already taken by another player in this tournament",
          },
          { status: 400 },
        );
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select("payout_structure")
        .eq("id", player.tournament_id)
        .single();
      if (tournamentError) {
        return Response.json({ error: tournamentError.message }, {
          status: 500,
        });
      }
      const payoutStructure = tournament.payout_structure as Record<
        string,
        number
      >;
      const potShare = payoutStructure[String(placement)];
      if (typeof potShare !== "number") {
        return Response.json(
          {
            error: `No payout percentage configured for placement ${placement}`,
          },
          { status: 400 },
        );
      }

      const { data: soldPlayers, error: soldPlayersError } = await ctx
        .supabaseAdmin
        .from("players")
        .select(
          "winning_bid:bids!players_winning_bid_id_fkey(amount)",
        )
        .eq("tournament_id", player.tournament_id)
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
      const amount = Math.round(pot * potShare * 100) / 100;

      const { data: payout, error: payoutError } = await ctx.supabaseAdmin
        .from("payouts")
        .upsert(
          {
            tournament_id: player.tournament_id,
            player_id: player.id,
            bidder_id: player.winning_bid.bidder_id,
            placement,
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
        .update({ placement })
        .eq("id", player.id);
      if (updatePlayerError) {
        return Response.json({ error: updatePlayerError.message }, {
          status: 400,
        });
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: player.tournament_id,
        player_id: player.id,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "placement_set",
        entity_type: "Player",
        entity_id: player.id,
        before: { placement: player.placement },
        after: {
          placement,
          payout_id: payout.id,
          pot_share: payout.pot_share,
          amount: payout.amount,
        },
        ip,
        user_agent,
      });

      return Response.json(
        {
          player: { id: player.id, placement },
          payout: {
            id: payout.id,
            placement: payout.placement,
            pot_share: payout.pot_share,
            amount: payout.amount,
            calculated_at: payout.calculated_at,
          },
        } satisfies SetPlacementResponse,
      );
    },
  ),
};
