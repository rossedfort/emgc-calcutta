// Split out of $lib/server/cursorPagination.ts: PAGE_SIZES needs to be
// importable from client-side page components (to render the page-size
// selector's options) as well as from server load functions (to validate
// the incoming page_size param) — SvelteKit's $lib/server/ directory is
// walled off from client code entirely, so anything both sides need can't
// live there even though the cursor-pagination logic alongside it (query
// building, encode/decode) genuinely is server-only.
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export function parsePageSize(raw: string | null): PageSize {
	const n = Number(raw);
	return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : 25;
}
