// Returns the caller's own `public.users` role. public.users has RLS enabled
// with no client-readable policies (see spec 6.5 / the upcoming RLS policies
// backlog item), so this is how server-side route guards (e.g. the /admin
// route group) resolve "what can this signed-in user see" without needing a
// self-read RLS policy yet.
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
      const { data, error } = await ctx.supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", ctx.userClaims!.id)
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      return Response.json({ id: ctx.userClaims!.id, role: data.role });
    },
  ),
};
