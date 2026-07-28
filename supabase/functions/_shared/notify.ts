// Shared by dispatch-notification (auction-event emails, opt-in gated) and
// notify-account-event (account-status emails, always-on, Phase 12) — both
// need the same send-then-log pairing: attempt the Resend send, and record
// the outcome as an audit_events row either way (spec 4.6's
// 'notification_sent' action, or 'notification_failed' with the provider's
// error as the reason), never throwing back to the caller — spec 4.7:
// "failed sends are logged, not retried indefinitely, and don't block ...
// state." What differs between the two callers (opt-out checks, whether a
// tournamentId/playerId applies, the email copy itself) stays in each
// function's own index.ts; this only owns the part that's identical.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";

import { logAuditEvent } from "./audit.ts";
import type { Database, Json } from "./database.ts";

export interface SendNotificationEmailParams {
  to: string;
  subject: string;
  text: string;
  audit: {
    tournament_id?: string | null;
    player_id?: string | null;
    entity_type: string;
    entity_id?: string | null;
    // Caller-specific fields (e.g. { trigger, subjectEmail }) — merged with
    // the subject/recipient this helper always logs, so every audit row
    // still records what was actually sent and to whom.
    after?: Json;
  };
}

export interface SendNotificationEmailResult {
  sent: boolean;
}

export async function sendNotificationEmail(
  resend: Resend,
  supabaseAdmin: SupabaseClient<Database>,
  { to, subject, text, audit }: SendNotificationEmailParams,
): Promise<SendNotificationEmailResult> {
  const { error } = await resend.emails.send({
    from: Deno.env.get("RESEND_FROM_EMAIL")!,
    to,
    subject,
    text,
  });

  const after = {
    ...(audit.after as Record<string, unknown> ?? {}),
    subject,
    recipient: to,
  };

  if (error) {
    await logAuditEvent(supabaseAdmin, {
      tournament_id: audit.tournament_id ?? null,
      player_id: audit.player_id ?? null,
      entity_type: audit.entity_type,
      entity_id: audit.entity_id ?? null,
      action: "notification_failed",
      reason: error.message,
      after,
    });
    return { sent: false };
  }

  await logAuditEvent(supabaseAdmin, {
    tournament_id: audit.tournament_id ?? null,
    player_id: audit.player_id ?? null,
    entity_type: audit.entity_type,
    entity_id: audit.entity_id ?? null,
    action: "notification_sent",
    after,
  });
  return { sent: true };
}
