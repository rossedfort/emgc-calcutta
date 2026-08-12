// Powers the Role management UI (apps/web /admin/users): returns every
// public.users row for an Admin/Owner caller, split into the three
// sections the UI renders (pending approval, everyone else, rejected).
// public.users has RLS enabled with no client-readable policies (see spec
// 6.5), so this goes through the service-role client rather than a direct
// RLS-permitted read.
//
// Phase 35: the "everyone else" section is offset-paginated and both it
// and pending/rejected are filtered server-side by search/role — see
// ../_shared/contracts/list-users.ts for why pending/rejected themselves
// stay unpaginated.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import type { Role } from "../_shared/roles.ts";
import type {
  ListUsersRequest,
  ListUsersResponse,
} from "../_shared/contracts/list-users.ts";

const USER_SELECT =
  "id, first_name, last_name, email, role, rejected_at, created_at";
const VALID_ROLES: readonly Role[] = [
  "unassigned",
  "participant",
  "admin",
  "owner",
];

function searchFilterExpression(search: string): string {
  const term = `%${search}%`;
  return `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`;
}

export default {
  fetch: withSupabase<Database>(
    {
      auth: "user",
      env: resolveSupabaseEnv(),
    },
    async (req, ctx) => {
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

      const body = await req.json().catch(() => null) as
        | Partial<ListUsersRequest>
        | null;

      const search = typeof body?.search === "string" ? body.search.trim() : "";
      const requestedRoles = Array.isArray(body?.roles)
        ? body.roles.filter((r): r is Role => VALID_ROLES.includes(r))
        : null;
      const limit = typeof body?.limit === "number" && body.limit > 0
        ? Math.min(body.limit, 100)
        : 25;
      const offset = typeof body?.offset === "number" && body.offset >= 0
        ? body.offset
        : 0;

      // A role filter that only names non-"unassigned" roles means neither
      // pending nor rejected (both always role = "unassigned") can ever
      // match — skip both queries rather than running ones guaranteed to
      // return nothing.
      const wantsUnassigned = !requestedRoles ||
        requestedRoles.includes("unassigned");
      const otherRoles = requestedRoles?.filter((r) => r !== "unassigned") ??
        null;
      const wantsOthers = !otherRoles || otherRoles.length > 0;

      const response: ListUsersResponse = {
        pending: [],
        rejected: [],
        others: [],
        othersTotal: 0,
      };

      if (wantsUnassigned) {
        let pendingQuery = ctx.supabaseAdmin
          .from("users")
          .select(USER_SELECT)
          .eq("role", "unassigned")
          .is("rejected_at", null)
          .order("created_at", { ascending: true });
        if (search) {
          pendingQuery = pendingQuery.or(searchFilterExpression(search));
        }
        const { data: pendingData, error: pendingError } = await pendingQuery;
        if (pendingError) {
          return Response.json({ error: pendingError.message }, {
            status: 500,
          });
        }
        response.pending = pendingData;

        let rejectedQuery = ctx.supabaseAdmin
          .from("users")
          .select(USER_SELECT)
          .eq("role", "unassigned")
          .not("rejected_at", "is", null)
          .order("created_at", { ascending: true });
        if (search) {
          rejectedQuery = rejectedQuery.or(searchFilterExpression(search));
        }
        const { data: rejectedData, error: rejectedError } =
          await rejectedQuery;
        if (rejectedError) {
          return Response.json({ error: rejectedError.message }, {
            status: 500,
          });
        }
        response.rejected = rejectedData;
      }

      if (wantsOthers) {
        let othersQuery = ctx.supabaseAdmin
          .from("users")
          .select(USER_SELECT, { count: "exact" })
          .neq("role", "unassigned")
          .order("created_at", { ascending: true })
          .range(offset, offset + limit - 1);
        if (otherRoles && otherRoles.length > 0) {
          othersQuery = othersQuery.in("role", otherRoles);
        }
        if (search) {
          othersQuery = othersQuery.or(searchFilterExpression(search));
        }
        const { data, error, count } = await othersQuery;
        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }
        response.others = data;
        response.othersTotal = count ?? 0;
      }

      return Response.json(response);
    },
  ),
};
