import type { Enums } from "../database.ts";

// GET/POST (auth: user, no body) -> the caller's own public.users role.
export interface WhoamiResponse {
  id: string;
  role: Enums<"user_role">;
}
