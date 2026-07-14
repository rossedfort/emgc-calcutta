// Validates and records a bid, silent or live (spec 4.3/4.4). Which phase
// applies is derived from the player's own current status, not a
// client-supplied field — same "read current state, don't trust the
// caller" philosophy as every other check in this function (roster
// membership, current high bid, idempotency):
//   status "open"     -> silent phase, gated by the tournament's
//                        silent_auction_start/end window
//   status "reserved" -> live phase, gated by that player having a
//                        currently-open live_lots row (opened_at set,
//                        closed_at null) — see the admin queue UI
//                        migration for how a lot gets opened
//   anything else      -> rejected outright, neither phase applies
//
// The current-high-bid lookup below is intentionally NOT filtered by
// phase — confirmed with the user rather than assumed: the silent bid
// that crossed the threshold and got a player reserved carries over as
// the live auction's opening floor, so the first live bid must still
// beat it by the minimum increment, same as any other new-high-bid
// check. This falls out for free by *not* scoping that query to the
// current phase, rather than needing special-case logic.
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
// After a successful silent bid, conditionally flips the player to
// "reserved" if the amount crosses the tournament's threshold — a
// silent-only concept, so live bids never trigger it (reserved is already
// where they started) — and, in the same step, auto-queues them for the
// live auction via enqueue_player_for_live_auction (Phase 4.5, user
// feedback: the queue builds itself, no Admin hand-add needed). This is
// three sequential writes (insert the Bid, then maybe update the Player,
// then maybe enqueue the lot), not a single atomic DB transaction —
// matching spec 6.5's own description of place-bid as a plain sequence
// within one Edge Function call, the same shape the original Fastify
// design would have had. A crash partway through could in theory leave a
// bid recorded without the reserved flip and/or the enqueue; revisit with
// a transactional RPC if that ever proves to be a real problem.
//
// Every live bid also resets live_lots.closes_at, the anti-snipe
// countdown (spec 4.4/182) — see the comment at that block below for the
// exact semantics.
//
// AuditEvent logging (for both the bid and the reserve event) is a
// separate, later backlog task — the table doesn't exist until Phase 5.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";
import type {
  PlaceBidRequest,
  PlaceBidResponse,
} from "../_shared/contracts/place-bid.ts";

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
        | Partial<PlaceBidRequest>
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

      let phase: "silent" | "live";
      if (player.status === "open") {
        phase = "silent";
      } else if (player.status === "reserved") {
        phase = "live";
      } else {
        return Response.json(
          { error: "This player isn't open for bidding" },
          { status: 400 },
        );
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select(
          "silent_auction_start, silent_auction_end, min_increment, threshold_amount, anti_snipe_seconds",
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

      let liveLotId: string | undefined;
      if (phase === "silent") {
        const now = new Date();
        if (
          now < new Date(tournament.silent_auction_start) ||
          now > new Date(tournament.silent_auction_end)
        ) {
          return Response.json({ error: "The silent auction isn't open" }, {
            status: 400,
          });
        }
      } else {
        const { data: liveLot, error: liveLotError } = await ctx.supabaseAdmin
          .from("live_lots")
          .select("id")
          .eq("tournament_id", player.tournament_id)
          .eq("player_id", body.playerId)
          .not("opened_at", "is", null)
          .is("closed_at", null)
          .maybeSingle();
        if (liveLotError) {
          return Response.json({ error: liveLotError.message }, {
            status: 500,
          });
        }
        if (!liveLot) {
          return Response.json(
            { error: "This player's live lot isn't open for bidding" },
            { status: 400 },
          );
        }
        liveLotId = liveLot.id;
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

      // Idempotency guard: a double-click or a network retry re-submitting
      // the exact same bid (same bidder, player, amount) within a few
      // seconds shouldn't create a second Bid row. Runs *before* the
      // current-high/increment check below — otherwise a same-amount
      // resubmission would always get misread as "too low" (the first
      // bid just became the new current high) instead of the accurate
      // "you already did this" message. Doesn't guard rapid *different*-
      // amount re-bids (e.g. quickly outbidding yourself after seeing a
      // competing bid land) — that's legitimate.
      const idempotencyCutoff = new Date(Date.now() - 5000).toISOString();
      const { data: recentDuplicate, error: duplicateError } = await ctx
        .supabaseAdmin
        .from("bids")
        .select("id")
        .eq("player_id", body.playerId)
        .eq("bidder_id", ctx.userClaims!.id)
        .eq("amount", body.amount)
        .gte("placed_at", idempotencyCutoff)
        .limit(1)
        .maybeSingle();
      if (duplicateError) {
        return Response.json({ error: duplicateError.message }, {
          status: 500,
        });
      }
      if (recentDuplicate) {
        return Response.json({
          error: "You just placed this bid — wait a moment before trying again",
        }, { status: 409 });
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
          phase,
        })
        .select("id, amount, phase, placed_at")
        .single();
      if (insertError) {
        return Response.json({ error: insertError.message }, {
          status: 400,
        });
      }

      // Crossing the threshold pulls the player from the silent pool and
      // freezes further silent bidding on them (spec 4.3) — a silent-only
      // concept, so this never runs for live bids: a live-phase player is
      // already "reserved", the very status this flip moves *into*.
      // `player.status` was already confirmed "open" above for the silent
      // branch, so this is necessarily the first bid to cross it — no risk
      // of double-reserving (and so no risk of double-enqueuing below
      // either).
      let reserved = false;
      if (phase === "silent" && body.amount >= tournament.threshold_amount) {
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

        // Auto-queue for the live auction (Phase 4.5, user feedback) — the
        // queue builds itself as the silent auction progresses rather than
        // needing an Admin to hand-add reserved players afterward. See the
        // migration for why this is its own advisory-locked function
        // rather than a plain insert here.
        const { error: enqueueError } = await ctx.supabaseAdmin.rpc(
          "enqueue_player_for_live_auction",
          { p_tournament_id: player.tournament_id, p_player_id: body.playerId },
        );
        if (enqueueError) {
          return Response.json({ error: enqueueError.message }, {
            status: 500,
          });
        }
      }

      // Anti-snipe (spec 4.4/182): every live bid resets the lot's
      // countdown to the full window, not just bids landing near expiry —
      // "a 15-second bid window resets to 15 seconds on any new bid" is
      // the spec's own phrasing. anti_snipe_seconds <= 0 means the
      // tournament has the feature disabled (spec: "can be disabled if a
      // human auctioneer is calling it live"), so closes_at is left alone
      // in that case rather than being set to a meaningless "now".
      // live_lots is already in the Realtime publication (see the
      // create_live_lots migration), so this update reaches connected
      // clients the same way any other lot change does — no separate
      // broadcast needed.
      if (phase === "live" && tournament.anti_snipe_seconds > 0) {
        const closesAt = new Date(
          Date.now() + tournament.anti_snipe_seconds * 1000,
        ).toISOString();
        const { error: closesAtError } = await ctx.supabaseAdmin
          .from("live_lots")
          .update({ closes_at: closesAt })
          .eq("id", liveLotId!);
        if (closesAtError) {
          return Response.json({ error: closesAtError.message }, {
            status: 500,
          });
        }
      }

      return Response.json({ bid, reserved } satisfies PlaceBidResponse);
    },
  ),
};
