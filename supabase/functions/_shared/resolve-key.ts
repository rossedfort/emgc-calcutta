// Local `supabase start` only exposes the new-style secret/publishable keys
// under SUPABASE_INTERNAL_*-prefixed names (it exposes the legacy anon/
// service-role keys unprefixed, but @supabase/server@1 doesn't fall back to
// those). The hosted Edge Functions platform auto-provisions the unprefixed
// SUPABASE_SECRET_KEY/SUPABASE_PUBLISHABLE_KEY directly, so this fallback
// chain covers both environments. See .claude/CLAUDE.md Known quirks.
export function resolveKey(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  return "";
}

export function resolveSupabaseEnv() {
  return {
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
  };
}
