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
// Deliberately does NOT check the acting bidder's own id against the
// *specific* target player's linked userId — self-bidding is normal,
// deliberate Calcutta behavior (spec 4.9), not a bug to guard against. This
// is a wholly separate concern from the roster-membership check below,
// which is about whether the acting bidder can bid in THIS TOURNAMENT at
// all, not about which specific player they're bidding on.
//
// "Acting bidder" (Phase 32): normally the caller themselves, but the
// request body's bidderId field lets an Admin/Owner caller place a bid on
// behalf of a different participant instead — see the on-behalf-of block
// near the top of the handler. Every check below that used to reference
// the caller's own id directly (roster membership, idempotency, the bid
// row's bidder_id/bidder_name) uses whichever identity is acting, so this
// entire flow works unchanged for the normal self-bid case where the two
// are the same.
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
// Logs an AuditEvent for both the bid and the reserve event (Phase 5's
// review pass) — awaited before responding, same reasoning as every other
// write in this function: this is meant to be a reliable trail, not
// best-effort background work an Edge Function isolate might not finish.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
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
        .select("role, first_name, last_name")
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
      if (!body?.entryId || typeof body.amount !== "number") {
        return Response.json(
          { error: "entryId and amount are required" },
          { status: 400 },
        );
      }
      if (!Number.isFinite(body.amount) || body.amount <= 0) {
        return Response.json({ error: "amount must be a positive number" }, {
          status: 400,
        });
      }

      // On-behalf-of bidding (Phase 32): the admin "Place bids" screen lets
      // an Admin/Owner enter bids for participants during the in-person
      // portion of the silent/live auction. bidderId is rejected outright
      // for a non-admin/owner caller, rather than silently falling back to
      // "place this as yourself" — a caller that explicitly asked to bid
      // for someone else and got a bid recorded under their own identity
      // instead would be a confusing, hard-to-notice footgun.
      let actingBidderId = ctx.userClaims!.id;
      let actingBidderName: string | null;
      const isOnBehalf = typeof body.bidderId === "string" &&
        body.bidderId.length > 0;
      if (isOnBehalf) {
        if (caller.role !== "admin" && caller.role !== "owner") {
          return Response.json({
            error:
              "Only an Admin or Owner can place a bid on behalf of another participant",
          }, { status: 403 });
        }
        const { data: targetUser, error: targetUserError } = await ctx
          .supabaseAdmin
          .from("users")
          .select("first_name, last_name")
          .eq("id", body.bidderId!)
          .maybeSingle();
        if (targetUserError) {
          return Response.json({ error: targetUserError.message }, {
            status: 500,
          });
        }
        if (!targetUser) {
          return Response.json({ error: "Participant not found" }, {
            status: 404,
          });
        }
        actingBidderId = body.bidderId!;
        actingBidderName = [targetUser.first_name, targetUser.last_name]
          .filter(Boolean)
          .join(" ") || null;
      } else {
        // Denormalized onto the row so it rides along on the existing
        // postgres_changes Realtime channel with zero extra queries — see
        // the bidder_name migration's own header comment for why this is
        // safe under bids_select_participant_plus's existing whole-row
        // grant. Null if the caller hasn't set a name yet (both columns are
        // nullable on `users`); the UI omits the "(name)" suffix in that
        // case rather than showing something empty/misleading.
        actingBidderName = [caller.first_name, caller.last_name]
          .filter(Boolean)
          .join(" ") || null;
      }

      const { data: entry, error: entryError } = await ctx.supabaseAdmin
        .from("player_entries")
        .select("id, player_id, tournament_id, status")
        .eq("id", body.entryId)
        .maybeSingle();
      if (entryError) {
        return Response.json({ error: entryError.message }, { status: 500 });
      }
      if (!entry) {
        return Response.json({ error: "Player not found" }, { status: 404 });
      }

      let phase: "silent" | "live";
      if (entry.status === "open") {
        phase = "silent";
      } else if (entry.status === "reserved") {
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
          "silent_auction_start, silent_auction_end, min_increment, threshold_amount, anti_snipe_seconds, minimum_bid",
        )
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
          .eq("tournament_id", entry.tournament_id)
          .eq("entry_id", body.entryId)
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
      // 4.9) — the acting bidder (the on-behalf participant, if this is an
      // admin-placed bid; otherwise the caller themselves) needs *a* Player
      // row in this tournament, not necessarily the one they're bidding on.
      const { data: rosterEntry, error: rosterError } = await ctx.supabaseAdmin
        .from("players")
        .select("id")
        .eq("tournament_id", entry.tournament_id)
        .eq("user_id", actingBidderId)
        .maybeSingle();
      if (rosterError) {
        return Response.json({ error: rosterError.message }, { status: 500 });
      }
      if (!rosterEntry) {
        return Response.json(
          {
            error: isOnBehalf
              ? "That participant isn't entered in this tournament"
              : "You're not entered in this tournament",
          },
          { status: isOnBehalf ? 400 : 403 },
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
        .eq("entry_id", body.entryId)
        .eq("bidder_id", actingBidderId)
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
          error: isOnBehalf
            ? "That bid was just placed for this participant — wait a moment before trying again"
            : "You just placed this bid — wait a moment before trying again",
        }, { status: 409 });
      }

      const { data: highBid, error: highBidError } = await ctx.supabaseAdmin
        .from("bids")
        .select("amount")
        .eq("entry_id", body.entryId)
        .is("voided_at", null)
        .order("amount", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (highBidError) {
        return Response.json({ error: highBidError.message }, {
          status: 500,
        });
      }

      if (highBid) {
        const standardMinimum = highBid.amount + tournament.min_increment;

        // Dead-zone fix (reported directly against production): the
        // threshold cap below rejects any silent bid over
        // threshold_amount, but the increment floor here normally
        // requires current high + min_increment — whenever that sum
        // exceeds the threshold (e.g. current high $95, increment $10,
        // threshold $100 -> $105 required but $100 is the most a silent
        // bid can ever be), no legal bid amount exists and the entry gets
        // stuck below threshold forever. Relax the increment specifically
        // in that zone: any amount strictly above the current high is
        // accepted (still capped at the threshold by the check below),
        // rather than requiring the full increment. This re-evaluates on
        // every bid, so it keeps relaxing for as long as the entry stays
        // in the dead zone and reverts to the normal full-increment rule
        // the moment a bid reaches the threshold (crossing it, per the
        // check below) or the standard minimum no longer overshoots it.
        // Live bids have no ceiling, so this dead zone can't occur there.
        const nearThreshold = phase === "silent" &&
          standardMinimum > tournament.threshold_amount;

        if (
          nearThreshold
            ? body.amount <= highBid.amount
            : body.amount < standardMinimum
        ) {
          return Response.json({
            error: nearThreshold
              ? `Bid must be more than the current high of $${
                highBid.amount.toFixed(2)
              } (the usual $${
                tournament.min_increment.toFixed(2)
              } minimum increment is relaxed this close to the $${
                tournament.threshold_amount.toFixed(2)
              } reservation threshold)`
              : `Bid must be at least $${
                standardMinimum.toFixed(2)
              } (current high $${highBid.amount.toFixed(2)} + $${
                tournament.min_increment.toFixed(2)
              } minimum increment)`,
          }, { status: 400 });
        }
      }

      // Phase 21: a floor on the very first bid an entry ever receives —
      // min_increment above only ever governs a bid once one already
      // exists, so without this an opening bid of $0.01 was accepted
      // outright (the only other floor being the generic amount > 0 check
      // earlier). Applies equally to a field lot's (Phase 20) first live
      // bid — a field entry enters the live auction having never received
      // a bid of its own, hitting this exact same highBid === null branch,
      // no phase-specific special-casing needed.
      if (!highBid && body.amount < tournament.minimum_bid) {
        return Response.json({
          error: `Bid must be at least $${
            tournament.minimum_bid.toFixed(2)
          } (minimum opening bid)`,
        }, { status: 400 });
      }

      // Silent bids are capped at the reservation threshold — nothing
      // previously stopped an amount from jumping straight past it (e.g.
      // current high $100, min increment $5, threshold $125: a $150 bid
      // was accepted outright and became the player's reserved silent
      // high bid instead of $125). A bid landing exactly at the threshold
      // still crosses it and reserves the player, same as before this
      // check — only an amount *exceeding* it is rejected. This keeps the
      // value carried into the live auction as the lot's opening price
      // always the threshold, never an arbitrary silent overbid; live
      // bidding itself stays uncapped once the lot opens.
      if (phase === "silent" && body.amount > tournament.threshold_amount) {
        return Response.json({
          error: `Silent bids cannot exceed the reservation threshold of $${
            tournament.threshold_amount.toFixed(2)
          }`,
        }, { status: 400 });
      }

      const { data: bid, error: insertError } = await ctx.supabaseAdmin
        .from("bids")
        .insert({
          entry_id: body.entryId,
          bidder_id: actingBidderId,
          amount: body.amount,
          phase,
          bidder_name: actingBidderName,
          placed_by_admin_id: isOnBehalf ? ctx.userClaims!.id : null,
        })
        .select("id, amount, phase, placed_at, bidder_id, placed_by_admin_id")
        .single();
      if (insertError) {
        return Response.json({ error: insertError.message }, {
          status: 400,
        });
      }

      const { ip, user_agent } = requestMetadata(req);
      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: entry.tournament_id,
        player_id: entry.player_id,
        entry_id: body.entryId,
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "bid_placed",
        entity_type: "Bid",
        entity_id: bid.id,
        after: {
          amount: bid.amount,
          phase: bid.phase,
          placed_at: bid.placed_at,
          bidder_id: bid.bidder_id,
          // Present whenever this was an admin-placed bid, so the audit
          // trail records both who acted (actor_id above) and who it was
          // placed for — otherwise indistinguishable from a self-placed
          // bid once written.
          placed_by_admin_id: bid.placed_by_admin_id,
        },
        ip,
        user_agent,
      });

      // Crossing the threshold pulls the player from the silent pool and
      // freezes further silent bidding on them (spec 4.3) — a silent-only
      // concept, so this never runs for live bids: a live-phase player is
      // already "reserved", the very status this flip moves *into*.
      // `entry.status` was already confirmed "open" above for the silent
      // branch, so this is necessarily the first bid to cross it — no risk
      // of double-reserving (and so no risk of double-enqueuing below
      // either).
      let reserved = false;
      if (phase === "silent" && body.amount >= tournament.threshold_amount) {
        const { error: reserveError } = await ctx.supabaseAdmin
          .from("player_entries")
          .update({ status: "reserved" })
          .eq("id", body.entryId);
        if (reserveError) {
          return Response.json({ error: reserveError.message }, {
            status: 500,
          });
        }
        reserved = true;

        await logAuditEvent(ctx.supabaseAdmin, {
          tournament_id: entry.tournament_id,
          player_id: entry.player_id,
          entry_id: body.entryId,
          actor_id: ctx.userClaims!.id,
          actor_identity: ctx.userClaims?.email ?? null,
          action: "player_reserved",
          entity_type: "PlayerEntry",
          entity_id: body.entryId,
          before: { status: "open" },
          after: { status: "reserved" },
          ip,
          user_agent,
        });

        // Auto-queue for the live auction (Phase 4.5, user feedback) — the
        // queue builds itself as the silent auction progresses rather than
        // needing an Admin to hand-add reserved players afterward. See the
        // migration for why this is its own advisory-locked function
        // rather than a plain insert here. p_player_id is deliberately
        // unchanged as the SQL-side parameter name (Phase 11 task 1) even
        // though it now receives a player_entries.id.
        const { error: enqueueError } = await ctx.supabaseAdmin.rpc(
          "enqueue_player_for_live_auction",
          { p_tournament_id: entry.tournament_id, p_player_id: body.entryId },
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
