// Powers the Role management UI (apps/web /admin/users): returns every
// public.users row for an Admin/Owner caller. public.users has RLS enabled
// with no client-readable policies (see spec 6.5), so this goes through the
// service-role client rather than a direct RLS-permitted read.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";

export default {
  fetch: withSupabase<Database>(
    {
      auth: "user",
      env: resolveSupabaseEnv(),
    },
    async (_req, ctx) => {
      const { data: caller, error: callerError } = await ctx.supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", ctx.userClaims!.id)
        .single();

      if (callerError) {
        return Response.json({ error: callerError.message }, { status: 500 });
      }
      if (!isAdminOrOwner(caller.role)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      const { data, error } = await ctx.supabaseAdmin
        .from("users")
        .select("id, name, email, role, created_at")
        .order("created_at", { ascending: true });

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      return Response.json({ users: data });
    },
  ),
};
