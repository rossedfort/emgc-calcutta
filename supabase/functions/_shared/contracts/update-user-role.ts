// See ../../update-user-role/index.ts — Admin/Owner role management (spec
// 3, 4.1) plus (Phase 12.5) rejecting/un-rejecting a still-unassigned
// signup. Reject/unreject never touch `role` itself (stays 'unassigned'
// throughout) — see the add_user_rejection migration's own comment for why
// rejection is a timestamp/actor pair rather than a new user_role enum
// value.
export type AccountAction = "reject" | "unreject";

export interface UpdateUserRoleRequest {
  userId: string;
  // Exactly one of role/action is present per call: role for the existing
  // role-management flow, action for the reject/unreject flow.
  role?: "unassigned" | "participant" | "admin";
  action?: AccountAction;
}

export interface UpdateUserRoleResponse {
  user: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    role: string;
    rejected_at: string | null;
    rejected_by: string | null;
    created_at: string;
  };
}
