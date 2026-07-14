// Validates and records a silent-auction bid. Live-phase bidding (spec
// 4.4) is a later Phase 4 task that reuses this same function scoped to
// phase: live — this only handles phase: silent for now.
//
// Per spec 6.5, this is the canonical place-bid pattern: read current
// state, validate, write — a single Edge Function call, not a DB-level
// transaction (the spec explicitly describes it this way, since RLS can't
// safely express "amount must exceed current high by the min increment"
// under concurrent bids).
//
// Deliberately does NOT check bidderId against the *specific* target
// player's linked userId — self-bidding is normal, deliberate Calcutta
// behavior (spec 4.9), not a bug to guard against. This is a wholly
// separate concern from the roster-membership check below, which is about
// whether the caller can bid in THIS TOURNAMENT at all, not about which
// specific player they're bidding on.
//
// After a successful bid, conditionally flips the player to "reserved" if
// the amount crosses the tournament's threshold. This is two sequential
// writes (insert the Bid, then maybe update the Player), not a single
// atomic DB transaction — matching spec 6.5's own description of place-bid
// as a plain sequence within one Edge Function call, the same shape the
// original Fastify design would have had. A crash between the two writes
// could in theory leave a bid recorded without the reserved flip; revisit
// with a transactional RPC if that ever proves to be a real problem.
//
// Idempotency guard and AuditEvent logging (for both the bid and the
// reserve event) are separate, later backlog tasks — AuditEvent's table
// doesn't exist until Phase 5.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";

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
      // "unassigned" is the only role that can never bid — Participant,
      // Admin, and Owner are all eligible, gated by roster membership
      // below, not by role. An Owner/Admin who's also a competitor is
      // ordinary (spec 4.9), not a special case.
      if (caller.role === "unassigned") {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      const body = await req.json().catch(() => null) as
        | { playerId?: string; amount?: number }
        | null;
      if (!body?.playerId || typeof body.amount !== "number") {
        return Response.json(
          { error: "playerId and amount are required" },
          { status: 400 },
        );
      }
      if (!Number.isFinite(body.amount) || body.amount <= 0) {
        return Response.json({ error: "amount must be a positive number" }, {
          status: 400,
        });
      }

      const { data: player, error: playerError } = await ctx.supabaseAdmin
        .from("players")
        .select("id, tournament_id, status")
        .eq("id", body.playerId)
        .maybeSingle();
      if (playerError) {
        return Response.json({ error: playerError.message }, { status: 500 });
      }
      if (!player) {
        return Response.json({ error: "Player not found" }, { status: 404 });
      }
      if (player.status !== "open") {
        return Response.json(
          { error: "This player isn't open for silent bidding" },
          { status: 400 },
        );
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select(
          "silent_auction_start, silent_auction_end, min_increment, threshold_amount",
        )
        .eq("id", player.tournament_id)
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

      const now = new Date();
      if (
        now < new Date(tournament.silent_auction_start) ||
        now > new Date(tournament.silent_auction_end)
      ) {
        return Response.json({ error: "The silent auction isn't open" }, {
          status: 400,
        });
      }

      // Bid eligibility is 1:1 with this tournament's Player roster (spec
      // 4.9) — the caller needs *a* Player row in this tournament, not
      // necessarily the one they're bidding on.
      const { data: rosterEntry, error: rosterError } = await ctx.supabaseAdmin
        .from("players")
        .select("id")
        .eq("tournament_id", player.tournament_id)
        .eq("user_id", ctx.userClaims!.id)
        .maybeSingle();
      if (rosterError) {
        return Response.json({ error: rosterError.message }, { status: 500 });
      }
      if (!rosterEntry) {
        return Response.json(
          { error: "You're not entered in this tournament" },
          { status: 403 },
        );
      }

      const { data: highBid, error: highBidError } = await ctx.supabaseAdmin
        .from("bids")
        .select("amount")
        .eq("player_id", body.playerId)
        .is("voided_at", null)
        .order("amount", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (highBidError) {
        return Response.json({ error: highBidError.message }, {
          status: 500,
        });
      }

      if (highBid && body.amount < highBid.amount + tournament.min_increment) {
        const minimum = highBid.amount + tournament.min_increment;
        return Response.json({
          error: `Bid must be at least $${minimum.toFixed(2)} (current high $${
            highBid.amount.toFixed(2)
          } + $${tournament.min_increment.toFixed(2)} minimum increment)`,
        }, { status: 400 });
      }

      const { data: bid, error: insertError } = await ctx.supabaseAdmin
        .from("bids")
        .insert({
          player_id: body.playerId,
          bidder_id: ctx.userClaims!.id,
          amount: body.amount,
          phase: "silent",
        })
        .select("id, amount, phase, placed_at")
        .single();
      if (insertError) {
        return Response.json({ error: insertError.message }, {
          status: 400,
        });
      }

      // Crossing the threshold pulls the player from the silent pool and
      // freezes further silent bidding on them (spec 4.3). `player.status`
      // was already confirmed "open" above, so this is necessarily the
      // first bid to cross it — no risk of double-reserving.
      let reserved = false;
      if (body.amount >= tournament.threshold_amount) {
        const { error: reserveError } = await ctx.supabaseAdmin
          .from("players")
          .update({ status: "reserved" })
          .eq("id", body.playerId);
        if (reserveError) {
          return Response.json({ error: reserveError.message }, {
            status: 500,
          });
        }
        reserved = true;
      }

      return Response.json({ bid, reserved });
    },
  ),
};
