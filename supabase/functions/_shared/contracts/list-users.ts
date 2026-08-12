// See ../../list-users/index.ts — Role management UI (spec 3, 4.1), plus
// Phase 35: offset pagination and server-side search/role filtering for
// the "everyone else" section (role != 'unassigned'). Pending and rejected
// (both role = 'unassigned') stay unpaginated by design — they exist
// specifically so an Admin never has to hunt for someone awaiting
// approval, and paginating those away would undermine that.
import type { Role } from "../roles.ts";

export interface ListUsersRequest {
  // Matches first_name, last_name, or email, case-insensitive.
  search?: string;
  // Restricts every section to these roles when present and non-empty —
  // e.g. filtering to role: ["admin"] naturally empties pending/rejected
  // (always role 'unassigned') without a special case, since neither
  // section's query runs at all unless "unassigned" is one of the
  // requested roles.
  roles?: Role[];
  // Page size/offset for the "others" section only.
  limit?: number;
  offset?: number;
}

export interface ListUsersUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: Role;
  rejected_at: string | null;
  created_at: string;
}

export interface ListUsersResponse {
  pending: ListUsersUser[];
  rejected: ListUsersUser[];
  others: ListUsersUser[];
  // Total rows matching the current search/role filters (before limit/
  // offset) — what the "others" section's Prev/Next and count badge are
  // computed against.
  othersTotal: number;
}
