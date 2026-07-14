// The canonical generated Database type lives at
// supabase/functions/_shared/database.ts, not here — the Supabase edge
// runtime only mounts supabase/ into its container (locally and at
// deploy time), so an Edge Function can't reach a relative import outside
// it, but apps/web has no such sandboxing and can resolve this path fine.
// See that file's header comment for the full explanation and
// regeneration instructions. Do not hand-edit either file independently.
export * from '../../../supabase/functions/_shared/database';
