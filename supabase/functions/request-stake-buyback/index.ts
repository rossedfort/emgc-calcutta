// A golfer requests buying back a percentage of their own stake from the
// winning bidder (Phase 14). Self-service, not an Admin action: the
// caller must be the entry's own linked golfer (players.user_id), not
// someone acting on their behalf — this is the "Buy back stake" button
// on /me/balance, gated the same way there and here: entry actually
// sold, the tournament has buy_back_percentage configured, before
// tournaments.event_start_at, and the caller isn't the winning bidder
// themselves (self-bidding is unrestricted elsewhere in this app per
// spec 4.9, but "buy back your own stake from yourself" is nonsensical).
//
// percentage/amount are computed here from tournament.buy_back_percentage
// and the entry's own winning_bid.amount, never trusted from the client
// — same "server computes the money math" posture set-placement already
// established for Payout.amount — then locked onto the stake_buybacks
// row so a later tournament-setting edit can't retroactively change an
// already-requested arrangement.
//
// Upserts on entry_id rather than always inserting: a rejected request
// can be reconsidered by re-requesting, which edits the same row back to
// 'pending' instead of accumulating a new row per attempt (matching this
// app's "nothing truly unrecoverable" pattern — void-bid, link/unlink,
// Phase 12.5's reject/un-reject). A 'pending' or 'accepted' existing row
// blocks a new request outright; only 'rejected' allows it.
//
// Sending the actual ask to the buyer is handled entirely by this app,
// not a mailto: draft composed client-side (that approach was tried and
// dropped) — this Edge Function creates the database row (including an
// optional personal note the golfer typed into the modal), and the
// stake_buybacks_notify_after_insert/_after_repending triggers (see the
// Phase 14 task 2 migration, extended by the message column's own
// migration) forward it into the existing dispatch-notification pipeline
// so the buyer gets one real email with no client mail app involved.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import type {
  RequestStakeBuybackRequest,
  RequestStakeBuybackResponse,
} from "../_shared/contracts/request-stake-buyback.ts";

export default {
  fetch: withSupabase<Database>(
    { auth: "user", env: resolveSupabaseEnv() },
    async (req, ctx) => {
      const body = await req.json().catch(() => null) as
        | Partial<RequestStakeBuybackRequest>
        | null;
      if (!body?.entryId) {
        return Response.json({ error: "entryId is required" }, {
          status: 400,
        });
      }

      // Matches the message column's own check constraint (char_length
      // <= 1000) — enforced here too so a too-long note comes back as a
      // clear 400 rather than a raw Postgres constraint-violation message.
      const messageRaw = typeof body.message === "string"
        ? body.message.trim()
        : null;
      if (messageRaw && messageRaw.length > 1000) {
        return Response.json(
          { error: "Message must be 1000 characters or fewer" },
          { status: 400 },
        );
      }
      const message = messageRaw || null;

      // winning_bid:bids!player_entries_winning_bid_id_fkey disambiguates
      // the embed the same way mark-bid-paid/void-bid/set-placement's own
      // queries do — player_entries<->bids has two FK paths (bids.entry_id
      // and player_entries.winning_bid_id). players/tournaments each only
      // have one FK path from player_entries, so those embed unqualified.
      const { data: entry, error: entryError } = await ctx.supabaseAdmin
        .from("player_entries")
        .select(
          "id, tournament_id, player_id, status, winning_bid_id, players(user_id), winning_bid:bids!player_entries_winning_bid_id_fkey(bidder_id, amount), tournaments(buy_back_percentage, event_start_at)",
        )
        .eq("id", body.entryId)
        .maybeSingle();
      if (entryError) {
        return Response.json({ error: entryError.message }, { status: 500 });
      }
      if (!entry) {
        return Response.json({ error: "Player not found" }, { status: 404 });
      }

      if (!entry.players || entry.players.user_id !== ctx.userClaims!.id) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      if (entry.status !== "sold_silent" && entry.status !== "sold_live") {
        return Response.json(
          { error: "This player has not sold" },
          { status: 400 },
        );
      }
      if (!entry.tournaments || entry.tournaments.buy_back_percentage == null) {
        return Response.json(
          { error: "Buy-back isn't enabled for this tournament" },
          { status: 400 },
        );
      }
      if (
        entry.tournaments.event_start_at &&
        new Date(entry.tournaments.event_start_at) <= new Date()
      ) {
        return Response.json(
          {
            error:
              "Too late to request a buy-back — the tournament has already started",
          },
          { status: 400 },
        );
      }
      if (!entry.winning_bid_id || !entry.winning_bid) {
        return Response.json(
          { error: "This player has no winning bid to buy back from" },
          { status: 400 },
        );
      }
      if (entry.winning_bid.bidder_id === ctx.userClaims!.id) {
        return Response.json(
          {
            error:
              "You're the winning bidder on this player — there's nothing to buy back",
          },
          { status: 400 },
        );
      }

      const { data: existing, error: existingError } = await ctx.supabaseAdmin
        .from("stake_buybacks")
        .select("id, status")
        .eq("entry_id", body.entryId)
        .maybeSingle();
      if (existingError) {
        return Response.json({ error: existingError.message }, {
          status: 500,
        });
      }
      if (existing?.status === "pending") {
        return Response.json(
          { error: "A buy-back request is already pending for this player" },
          { status: 400 },
        );
      }
      if (existing?.status === "accepted") {
        return Response.json(
          { error: "A buy-back has already been accepted for this player" },
          { status: 400 },
        );
      }

      const percentage = entry.tournaments.buy_back_percentage;
      const amount = Math.round(entry.winning_bid.amount * percentage * 100) /
        100;

      const { data: stakeBuyback, error: upsertError } = await ctx
        .supabaseAdmin
        .from("stake_buybacks")
        .upsert(
          {
            tournament_id: entry.tournament_id,
            entry_id: body.entryId,
            requester_id: ctx.userClaims!.id,
            buyer_id: entry.winning_bid.bidder_id,
            percentage,
            amount,
            message,
            status: "pending",
            requested_at: new Date().toISOString(),
            responded_at: null,
            responded_by: null,
          },
          { onConflict: "entry_id" },
        )
        .select("id, status, percentage, amount")
        .single();
      if (upsertError) {
        return Response.json({ error: upsertError.message }, {
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
        action: "stake_buyback_requested",
        entity_type: "PlayerEntry",
        entity_id: entry.id,
        after: {
          stake_buyback_id: stakeBuyback.id,
          buyer_id: entry.winning_bid.bidder_id,
          percentage,
          amount,
          message,
        },
        ip,
        user_agent,
      });

      return Response.json(
        {
          stakeBuyback: {
            id: stakeBuyback.id,
            status: "pending",
            percentage: stakeBuyback.percentage,
            amount: stakeBuyback.amount,
          },
        } satisfies RequestStakeBuybackResponse,
      );
    },
  ),
};
