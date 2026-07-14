// Every Edge Function in this project returns this same shape on failure
// (400/403/404/409/500 — see each function's own comments for which
// statuses it uses and why). Useful for typing a manually-parsed error
// body, e.g. `await (error as FunctionsHttpError).context.json()` after a
// non-2xx `supabase.functions.invoke(...)` response on the apps/web side.
export interface ErrorResponse {
  error: string;
}
