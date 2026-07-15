// Sends one notification email via Resend and logs the outcome (spec
// 4.7/6.7) — email-only per the Phase 6 header's confirmed deviation
// (Twilio/SMS dropped, SendGrid swapped for Resend).
//
// Invoked internally by Database Webhook / Postgres trigger logic (later
// backlog tasks build the actual triggers on Bid/LiveLot/Player changes)
// — not by end users, so this uses `auth: "secret"` rather than the
// `auth: "user"` every other function in this project uses: the caller
// presents the project's own secret/service-role key directly, proving
// it's a trusted internal caller, not someone's browser session. The
// caller already knows *who* to notify and *why* (current-high-bid,
// Player.userId, tournament roster — all doable in plain SQL from a
// trigger); this function's only job is "send it, and log what
// happened."
//
// Deliberately does NOT yet check NotificationPref (opt-out) — that's
// its own separate backlog line ("Respect opt-out"), and nothing calls
// this function for real yet (the Database Webhook tasks haven't landed),
// so there's no user-facing gap left temporarily open by building this
// piece first.
//
// Per spec 4.7's "failed sends are logged, not retried indefinitely, and
// don't block the real-time broadcast or UI update": a failed Resend
// call is a normal, logged outcome (audit action 'notification_failed',
// response { sent: false }), never an HTTP error — there's nothing to
// retry, and nothing waiting on this call should be blocked by an email
// provider hiccup.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { Resend } from "resend";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { logAuditEvent } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import type {
  DispatchNotificationRequest,
  DispatchNotificationResponse,
  NotificationTrigger,
} from "../_shared/contracts/dispatch-notification.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface EmailContent {
  subject: string;
  text: string;
}

// Copy lives in exactly one place rather than scattered across every
// future trigger-calling site (the Bid webhook, the LiveLot webhook,
// ...), so updating the wording later is a one-file change.
function buildEmail(
  trigger: NotificationTrigger,
  playerName: string | null,
  tournamentName: string,
  amount: number | undefined,
): EmailContent {
  const formattedAmount = amount !== undefined
    ? `$${
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }`
    : undefined;

  switch (trigger) {
    case "outbid":
      return {
        subject: `You've been outbid on ${playerName}`,
        text:
          `${formattedAmount} is the new high bid on ${playerName} in ${tournamentName}.`,
      };
    case "bid_on_you":
      return {
        subject: `A bid was placed on you in ${tournamentName}`,
        text:
          `${formattedAmount} was just bid on you (${playerName}) in ${tournamentName}.`,
      };
    case "reserved":
      return {
        subject: `${playerName} has been reserved for the live auction`,
        text:
          `${playerName}'s silent-auction bidding crossed the reserve threshold in ${tournamentName} — they'll go to the live auction instead of closing silently.`,
      };
    case "live_starting":
      return {
        subject: `The live auction for ${tournamentName} is starting`,
        text:
          `The live auction for ${tournamentName} has opened. You have a reserved player in this event.`,
      };
    case "won":
      return {
        subject: `You won ${playerName}!`,
        text:
          `Your bid of ${formattedAmount} won ${playerName} in ${tournamentName}. Congratulations!`,
      };
  }
}

export default {
  fetch: withSupabase<Database>(
    { auth: "secret", env: resolveSupabaseEnv() },
    async (req, ctx) => {
      const body = await req.json().catch(() => null) as
        | Partial<DispatchNotificationRequest>
        | null;
      if (!body?.userId || !body.trigger || !body.tournamentId) {
        return Response.json(
          { error: "userId, trigger, and tournamentId are required" },
          { status: 400 },
        );
      }

      const { data: recipient, error: recipientError } = await ctx
        .supabaseAdmin
        .from("users")
        .select("email")
        .eq("id", body.userId)
        .maybeSingle();
      if (recipientError) {
        return Response.json({ error: recipientError.message }, {
          status: 500,
        });
      }
      if (!recipient) {
        return Response.json({ error: "Recipient not found" }, {
          status: 404,
        });
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select("name")
        .eq("id", body.tournamentId)
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

      let playerName: string | null = null;
      if (body.playerId) {
        const { data: player, error: playerError } = await ctx.supabaseAdmin
          .from("players")
          .select("name")
          .eq("id", body.playerId)
          .maybeSingle();
        if (playerError) {
          return Response.json({ error: playerError.message }, {
            status: 500,
          });
        }
        playerName = player?.name ?? null;
      }

      const email = buildEmail(
        body.trigger,
        playerName,
        tournament.name,
        body.amount,
      );

      // entity_type/entity_id describe what the notification is *about*
      // (a Player for every trigger except the tournament-wide
      // live_starting), not the notification mechanism itself — more
      // useful for dispute/debugging than a generic 'NotificationPref'
      // entity would be.
      const entityType = body.playerId ? "Player" : "Tournament";
      const entityId = body.playerId ?? body.tournamentId;

      const { error: sendError } = await resend.emails.send({
        from: Deno.env.get("RESEND_FROM_EMAIL")!,
        to: recipient.email,
        subject: email.subject,
        text: email.text,
      });

      if (sendError) {
        await logAuditEvent(ctx.supabaseAdmin, {
          tournament_id: body.tournamentId,
          player_id: body.playerId ?? null,
          action: "notification_failed",
          entity_type: entityType,
          entity_id: entityId,
          reason: sendError.message,
          after: {
            trigger: body.trigger,
            subject: email.subject,
            recipient: recipient.email,
          },
        });
        return Response.json(
          { sent: false } satisfies DispatchNotificationResponse,
        );
      }

      await logAuditEvent(ctx.supabaseAdmin, {
        tournament_id: body.tournamentId,
        player_id: body.playerId ?? null,
        action: "notification_sent",
        entity_type: entityType,
        entity_id: entityId,
        after: {
          trigger: body.trigger,
          subject: email.subject,
          recipient: recipient.email,
        },
      });

      return Response.json(
        { sent: true } satisfies DispatchNotificationResponse,
      );
    },
  ),
};
