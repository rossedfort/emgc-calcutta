// Role names as stored in public.users.role (see the user_role Postgres enum
// in supabase/migrations). Kept as plain strings rather than importing the
// enum, matching the "no generated types yet" convention used elsewhere in
// these functions (see spec 6.8).
export type Role = "unassigned" | "participant" | "admin" | "owner";

// Roles a Role management UI action is ever allowed to set someone *to*.
// "owner" is deliberately excluded — there's exactly one Owner, established
// once by the bootstrap-owner flow, and this project has no UI path to
// transfer or grant ownership.
export const ASSIGNABLE_ROLES = ["unassigned", "participant", "admin"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

export function isAdminOrOwner(role: string): boolean {
  return role === "admin" || role === "owner";
}
