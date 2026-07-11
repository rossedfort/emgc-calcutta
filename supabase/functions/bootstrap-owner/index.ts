// Bootstrap flow (spec section 4.1): promotes the caller to 'owner' if their
// email matches the env-configured OWNER_EMAIL. Called from the app right
// after a successful sign-in (see apps/web's auth callback route). Safe to
// call on every login — the `.eq('role', 'unassigned')` guard makes it a
// no-op once the owner has been assigned (or if an Admin/Owner later changes
// that user's role by hand, this won't stomp on it).
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// No generated Supabase types in this project yet (see spec 6.8) — this is
// just enough of the shape for the one table/column this function touches.
interface Database {
  public: {
    Tables: {
      users: {
        Row: { id: string; role: string };
        Insert: { id: string; role?: string };
        Update: { role?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Local `supabase start` only exposes the new-style secret/publishable keys
// under SUPABASE_INTERNAL_*-prefixed names (it exposes the legacy anon/
// service-role keys unprefixed, but @supabase/server@1 doesn't fall back to
// those). The hosted Edge Functions platform auto-provisions the unprefixed
// SUPABASE_SECRET_KEY/SUPABASE_PUBLISHABLE_KEY directly, so this fallback
// chain covers both environments. See .claude/CLAUDE.md Known quirks.
function resolveKey(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  return "";
}

export default {
  fetch: withSupabase<Database>(
    {
      auth: "user",
      env: {
        secretKeys: {
          default: resolveKey(
            "SUPABASE_SECRET_KEY",
            "SUPABASE_INTERNAL_SECRET_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
          ),
        },
        publishableKeys: {
          default: resolveKey(
            "SUPABASE_PUBLISHABLE_KEY",
            "SUPABASE_INTERNAL_PUBLISHABLE_KEY",
            "SUPABASE_ANON_KEY",
          ),
        },
      },
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
