// Shared by every append-only, newest-first admin table that gets cursor
// pagination (Audit Events first, Silent Auction Bids next per the backlog's
// own "template the other two tables can follow" note) — the tricky parts
// (composite cursor encoding, the bidirectional hasNext/hasPrev logic) only
// need working out once. Column-name-agnostic (`sortColumn` passed in at
// each call site) since the two tables sort by different timestamp columns
// (audit_events.created_at, bids.placed_at).
export type CursorDirection = 'before' | 'after';

export interface Cursor {
	sortValue: string;
	id: string;
}

// sortValue is an ISO timestamp (no literal "|"), id is a uuid (no "|"
// either) — a single separator is enough, no need for URL-unsafe framing;
// URLSearchParams handles percent-encoding the whole value automatically.
const CURSOR_SEPARATOR = '|';

export function encodeCursor(cursor: Cursor): string {
	return `${cursor.sortValue}${CURSOR_SEPARATOR}${cursor.id}`;
}

export function decodeCursor(raw: string | null): Cursor | null {
	if (!raw) return null;
	const separatorIndex = raw.lastIndexOf(CURSOR_SEPARATOR);
	if (separatorIndex === -1) return null;
	const sortValue = raw.slice(0, separatorIndex);
	const id = raw.slice(separatorIndex + 1);
	if (!sortValue || !id) return null;
	return { sortValue, id };
}

export function parseCursorDirection(raw: string | null): CursorDirection {
	return raw === 'after' ? 'after' : 'before';
}

// A raw PostgREST `.or()` filter string expressing a strict tuple
// comparison — (sortColumn, id) </> cursor — rather than filtering on the
// sort column alone: two rows (audit events, bids) landing in the same
// transaction can share an identical timestamp down to the microsecond,
// and a single-column cursor would silently skip or duplicate one of them
// across a page boundary. Only meaningful alongside a matching
// `.order(sortColumn, {ascending}).order('id', {ascending})` on the same
// query, so the tiebreak this expresses actually matches fetch order.
export function cursorFilterExpression(
	cursor: Cursor,
	direction: CursorDirection,
	sortColumn: string
): string {
	const op = direction === 'before' ? 'lt' : 'gt';
	return `${sortColumn}.${op}.${cursor.sortValue},and(${sortColumn}.eq.${cursor.sortValue},id.${op}.${cursor.id})`;
}

export interface CursorPage<T> {
	rows: T[];
	hasNext: boolean;
	hasPrev: boolean;
}

// Turns `pageSize + 1` freshly-fetched rows (already ordered to match
// `direction` — desc for 'before', asc for 'after', per cursorFilterExpression's
// own ordering requirement) into a page in stable newest-first display
// order, trimmed back to `pageSize`, plus whether a further Prev/Next page
// exists beyond what's shown:
//   - 'before' (the default fetch direction, and what Next uses): fetched
//     rows are already in display order. The (pageSize + 1)th row, if
//     present, proves an older page exists (hasNext) — dropped before
//     display. hasPrev is simply whether a cursor was supplied at all: a
//     cursor-less 'before' fetch is by definition the newest page, the one
//     no Prev can go further back from.
//   - 'after' (what Prev uses): fetched ascending, so reversed to get
//     display order. Since an 'after' fetch only ever happens by clicking
//     Prev from a page that still exists, hasNext is unconditionally true.
//     Its own extra (pageSize + 1)th row (dropped before display) proves a
//     still-earlier page exists beyond this one (hasPrev).
export function buildCursorPage<T>(
	fetched: T[],
	direction: CursorDirection,
	cursorPresent: boolean,
	pageSize: number
): CursorPage<T> {
	const hasMore = fetched.length > pageSize;
	const trimmed = fetched.slice(0, pageSize);
	const rows = direction === 'after' ? [...trimmed].reverse() : trimmed;

	return {
		rows,
		hasNext: direction === 'before' ? hasMore : true,
		hasPrev: direction === 'before' ? cursorPresent : hasMore
	};
}
