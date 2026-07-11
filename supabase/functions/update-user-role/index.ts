// Powers the Role management UI (apps/web /admin/users). Role changes are
// validated business logic, not a raw RLS-permitted write (see spec 6.5):
// - Only Admin/Owner may call this at all.
// - A caller can never change their own role (avoids self-lockout, e.g. the
//   Owner demoting themselves).
// - Only the Owner may grant or revoke the "admin" role, or change another
//   admin's role at all — a plain Admin may only toggle a non-admin target
//   between "unassigned" and "participant".
// - The "owner" role itself is never a valid target — there's exactly one
//   Owner, established once by the bootstrap-owner flow, and this project
//   has no UI path to transfer or grant ownership.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";
import { isAdminOrOwner, isAssignableRole } from "../_shared/roles.ts";

export default {
  fetch: withSupabase<Database>(
    {
      auth: "user",
      env: resolveSupabaseEnv(),
    },
    async (req, ctx) => {
      const body = await req.json().catch(() => null);
      const userId = body?.userId;
      const role = body?.role;

      if (typeof userId !== "string" || typeof role !== "string" || !isAssignableRole(role)) {
        return Response.json({ error: "Invalid userId or role" }, { status: 400 });
      }
      if (userId === ctx.userClaims!.id) {
        return Response.json({ error: "You cannot change your own role" }, { status: 400 });
      }

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

      const { data: target, error: targetError } = await ctx.supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", userId)
        .single();
      if (targetError) {
        return Response.json({ error: targetError.message }, { status: 404 });
      }
      if (target.role === "owner") {
        return Response.json({ error: "Cannot change the Owner's role" }, { status: 403 });
      }

      const callerIsPlainAdmin = caller.role === "admin";
      const touchesAdmin = role === "admin" || target.role === "admin";
      if (callerIsPlainAdmin && touchesAdmin) {
        return Response.json({ error: "Only the Owner can manage Admins" }, { status: 403 });
      }

      const { data, error } = await ctx.supabaseAdmin
        .from("users")
        .update({ role })
        .eq("id", userId)
        .select("id, name, email, role, created_at")
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      return Response.json({ user: data });
    },
  ),
};
