// Canonical copy lives under supabase/functions/_shared/contracts — see
// that directory's files and packages/shared-types/src/database.ts's
// header comment for why (the Supabase edge runtime can't reach outside
// supabase/, so Edge Functions need their own copy; apps/web has no such
// sandboxing and re-exports from there instead of the other way around).
export * from '../../../../supabase/functions/_shared/contracts/common';
