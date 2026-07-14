// Bootstrap flow (spec section 4.1): promotes the caller to 'owner' if their
// email matches the env-configured OWNER_EMAIL. Called from the app right
// after a successful sign-in (see apps/web's auth callback route). Safe to
// call on every login — the `.eq('role', 'unassigned')` guard makes it a
// no-op once the owner has been assigned (or if an Admin/Owner later changes
// that user's role by hand, this won't stomp on it).
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";

export default {
  fetch: withSupabase<Database>(
    {
      auth: "user",
      env: resolveSupabaseEnv(),
    },
    async (req, ctx) => {
      const ownerEmail = Deno.env.get("OWNER_EMAIL");
      const callerEmail = ctx.userClaims?.email;

      if (
        !ownerEmail || !callerEmail ||
        callerEmail.toLowerCase() !== ownerEmail.toLowerCase()
      ) {
        return Response.json({ promoted: false });
      }

      // ctx.supabaseAdmin uses the secret key and bypasses RLS — required
      // here since public.users has RLS enabled with no client-writable
      // policies.
      const { data, error } = await ctx.supabaseAdmin
        .from("users")
        .update({ role: "owner" })
        .eq("id", ctx.userClaims!.id)
        .eq("role", "unassigned")
        .select("id")
        .maybeSingle();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      // Called on every login, but the .eq('role', 'unassigned') guard
      // means the update only ever actually matches a row once — only log
      // an event that once, not on every subsequent no-op call.
      if (data) {
        const { ip, user_agent } = requestMetadata(req);
        await logAuditEvent(ctx.supabaseAdmin, {
          actor_id: ctx.userClaims!.id,
          actor_identity: callerEmail,
          action: "role_change",
          entity_type: "User",
          entity_id: ctx.userClaims!.id,
          before: { role: "unassigned" },
          after: { role: "owner" },
          ip,
          user_agent,
        });
      }

      return Response.json({ promoted: true });
    },
  ),
};
