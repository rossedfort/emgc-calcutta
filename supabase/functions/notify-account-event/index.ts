// Sends the two account-level notifications spec 4.1's first-login flow
// creates a need for (Phase 12): a new-signup alert to every Admin/Owner,
// and a "you're approved" email to a newly-promoted Participant. Deliberately
// NOT dispatch-notification (see .claude/emgc-calcutta-app-backlog.md Phase
// 12's design-decision note): neither trigger has a tournamentId, and
// neither is something an account holder should be able to silently opt out
// of the way auction notifications (spec 4.7) can be — an Admin should
// always hear about a pending signup, an approved user should always hear
// they're approved. Shares the actual send-then-log pairing with
// dispatch-notification via _shared/notify.ts rather than duplicating it;
// what differs here is only the lack of a tournamentId/opt-in check and this
// function's own two-trigger email copy.
//
// Two call sites, matching dispatch-notification's own "invoked internally,
// not by end users" shape: a Database Webhook trigger on public.users
// inserts (new_signup, fanned out once per Admin/Owner — see the
// notify_admins_of_new_signup() migration) and update-user-role's Edge
// Function calling this directly via its own service-role client
// (account_approved, the unassigned -> participant transition only). Both
// present the secret/service-role key, hence `auth: "secret"` here too.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { Resend } from "resend";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { sendNotificationEmail } from "../_shared/notify.ts";
import {
  emailButton,
  emailParagraph,
  renderEmailLayout,
} from "../_shared/email-layout.ts";
import type { Database } from "../_shared/database.ts";
import type {
  AccountEventTrigger,
  NotifyAccountEventRequest,
  NotifyAccountEventResponse,
} from "../_shared/contracts/notify-account-event.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface EmailContent {
  subject: string;
  text: string;
  // Only set for triggers migrated to the shared HTML layout (see
  // emgc-calcutta-app-backlog.md Phase 13). Deliberately never passes a
  // settingsUrl to renderEmailLayout() — unlike dispatch-notification's
  // triggers, neither new_signup nor account_approved is gated by
  // notification_prefs (spec 4.7's opt-in only covers auction
  // notifications), so a "manage preferences" link here would be
  // misleading — there's nothing for the recipient to opt out of.
  html?: string;
}

function buildEmail(
  trigger: AccountEventTrigger,
  subjectName: string | null | undefined,
  subjectEmail: string | undefined,
): EmailContent {
  switch (trigger) {
    case "new_signup": {
      const subject = "New sign-up awaiting approval";
      const text = `${
        subjectName ?? subjectEmail ?? "Someone"
      } just signed up and is waiting for an Admin to assign their role. Review them at the admin > users page.`;
      return {
        subject,
        text,
        html: renderEmailLayout({
          previewText: text,
          heading: subject,
          bodyHtml: [
            emailParagraph(text),
            emailButton(
              "Review sign-ups",
              `${Deno.env.get("SITE_URL")}/admin/users`,
            ),
          ].join("\n"),
        }),
      };
    }
    case "account_approved":
      return {
        subject: "You're approved",
        text:
          "An Admin has approved your account. You'll be able to view and bid once a tournament's auction opens.",
      };
  }
}

export default {
  fetch: withSupabase<Database>(
    { auth: "secret", env: resolveSupabaseEnv() },
    async (req, ctx) => {
      const body = await req.json().catch(() => null) as
        | Partial<NotifyAccountEventRequest>
        | null;
      if (
        !body?.userId ||
        (body.trigger !== "new_signup" && body.trigger !== "account_approved")
      ) {
        return Response.json(
          { error: "userId and a valid trigger are required" },
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

      const email = buildEmail(
        body.trigger,
        body.subjectName,
        body.subjectEmail,
      );

      const result = await sendNotificationEmail(resend, ctx.supabaseAdmin, {
        to: recipient.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        audit: {
          entity_type: "User",
          entity_id: body.userId,
          after: {
            trigger: body.trigger,
            subjectEmail: body.subjectEmail ?? null,
          },
        },
      });

      return Response.json(result satisfies NotifyAccountEventResponse);
    },
  ),
};
