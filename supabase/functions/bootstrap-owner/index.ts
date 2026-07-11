// Bootstrap flow (spec section 4.1): promotes the caller to 'owner' if their
// email matches the env-configured OWNER_EMAIL. Called from the app right
// after a successful sign-in (see apps/web's auth callback route). Safe to
// call on every login — the `.eq('role', 'unassigned')` guard makes it a
// no-op once the owner has been assigned (or if an Admin/Owner later changes
// that user's role by hand, this won't stomp on it).
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";

export default {
  fetch: withSupabase<Database>(
    {
      auth: "user",
      env: resolveSupabaseEnv(),
    },
    async (_req, ctx) => {
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
      const { error } = await ctx.supabaseAdmin
        .from("users")
        .update({ role: "owner" })
        .eq("id", ctx.userClaims!.id)
        .eq("role", "unassigned");

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      return Response.json({ promoted: true });
    },
  ),
};
