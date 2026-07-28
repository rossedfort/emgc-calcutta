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
//
// Also handles reject/unreject (Phase 12.5) — a still-unassigned signup an
// Admin/Owner has determined doesn't belong (someone outside the league).
// Kept in this same function/RBAC surface rather than a separate one:
// exactly one of `role`/`action` is present per request, and reject/
// unreject share every guard above except the role-specific ones, since
// they never touch `role` itself — see add_user_rejection.sql for why
// rejection is a timestamp/actor pair, not a new role value.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import { logAuditEvent, requestMetadata } from "../_shared/audit.ts";
import type { Database } from "../_shared/database.ts";
import { isAdminOrOwner, isAssignableRole } from "../_shared/roles.ts";
import type { NotifyAccountEventRequest } from "../_shared/contracts/notify-account-event.ts";
import type {
  UpdateUserRoleRequest,
  UpdateUserRoleResponse,
} from "../_shared/contracts/update-user-role.ts";

const USER_SELECT =
  "id, first_name, last_name, email, role, rejected_at, rejected_by, created_at";

export default {
  fetch: withSupabase<Database>(
    {
      auth: "user",
      env: resolveSupabaseEnv(),
    },
    async (req, ctx) => {
      const body = await req.json().catch(() => null) as
        | Partial<UpdateUserRoleRequest>
        | null;
      const userId = body?.userId;
      const role = body?.role;
      const action = body?.action;

      const wantsRoleChange = typeof role === "string";
      const wantsAction = action === "reject" || action === "unreject";
      if (
        typeof userId !== "string" ||
        wantsRoleChange === wantsAction || // exactly one of the two
        (wantsRoleChange && !isAssignableRole(role))
      ) {
        return Response.json({ error: "Invalid userId, role, or action" }, {
          status: 400,
        });
      }
      if (userId === ctx.userClaims!.id) {
        return Response.json({ error: "You cannot change your own account" }, {
          status: 400,
        });
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
        .select("role, rejected_at")
        .eq("id", userId)
        .single();
      if (targetError) {
        return Response.json({ error: targetError.message }, { status: 404 });
      }
      if (target.role === "owner") {
        return Response.json({ error: "Cannot change the Owner's role" }, {
          status: 403,
        });
      }

      const { ip, user_agent } = requestMetadata(req);

      if (wantsAction) {
        if (action === "reject" && target.role !== "unassigned") {
          return Response.json({
            error: "Only unassigned users can be rejected",
          }, { status: 400 });
        }
        if (action === "unreject" && target.rejected_at === null) {
          return Response.json({ error: "User is not rejected" }, {
            status: 400,
          });
        }

        const rejecting = action === "reject";
        const { data, error } = await ctx.supabaseAdmin
          .from("users")
          .update({
            rejected_at: rejecting ? new Date().toISOString() : null,
            rejected_by: rejecting ? ctx.userClaims!.id : null,
          })
          .eq("id", userId)
          .select(USER_SELECT)
          .single();
        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }

        await logAuditEvent(ctx.supabaseAdmin, {
          actor_id: ctx.userClaims!.id,
          actor_identity: ctx.userClaims?.email ?? null,
          action: rejecting ? "user_rejected" : "user_unrejected",
          entity_type: "User",
          entity_id: userId,
          before: { rejected_at: target.rejected_at },
          after: { rejected_at: data.rejected_at },
          ip,
          user_agent,
        });

        return Response.json({ user: data } satisfies UpdateUserRoleResponse);
      }

      const callerIsPlainAdmin = caller.role === "admin";
      const touchesAdmin = role === "admin" || target.role === "admin";
      if (callerIsPlainAdmin && touchesAdmin) {
        return Response.json({ error: "Only the Owner can manage Admins" }, {
          status: 403,
        });
      }

      const { data, error } = await ctx.supabaseAdmin
        .from("users")
        .update({ role })
        .eq("id", userId)
        .select(USER_SELECT)
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      await logAuditEvent(ctx.supabaseAdmin, {
        actor_id: ctx.userClaims!.id,
        actor_identity: ctx.userClaims?.email ?? null,
        action: "role_change",
        entity_type: "User",
        entity_id: userId,
        before: { role: target.role },
        after: { role: data.role },
        ip,
        user_agent,
      });

      // "You're approved" (Phase 12): only the actual unassigned ->
      // participant approval moment, not every role change — an Owner
      // promoting an existing Participant to Admin, or a demotion,
      // shouldn't re-fire a welcome email. Best-effort: a failed call here
      // must never fail this request, since the role change itself already
      // committed above (same reasoning as logAuditEvent's own failure
      // handling just above).
      if (target.role === "unassigned" && role === "participant") {
        const { error: notifyError } = await ctx.supabaseAdmin.functions
          .invoke("notify-account-event", {
            body: {
              userId,
              trigger: "account_approved",
            } satisfies NotifyAccountEventRequest,
          });
        if (notifyError) {
          console.error(
            "Failed to send account_approved notification:",
            notifyError.message,
          );
        }
      }

      return Response.json({ user: data } satisfies UpdateUserRoleResponse);
    },
  ),
};
