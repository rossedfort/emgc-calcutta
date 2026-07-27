// Generic date-diff formatting, not tied to any particular domain (Bid,
// Tournament, ...) — every caller passes `now` explicitly rather than this
// reading `new Date()` itself, so a page that ticks its own `now` state
// (to keep a countdown or "time ago" live) stays in full control of when
// these actually update.

export function formatRelativeTime(date: Date, now: Date): string {
	const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
	if (seconds < 60) return 'Just now';

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}

// "1d 02h 03m" once a full day out, "02:03:04" once inside the final day —
// shared by the phase banner's countdown and the live board's anti-snipe
// countdown so neither duplicates the format.
export function formatCountdown(target: Date, now: Date): string | null {
	const totalSeconds = Math.floor((target.getTime() - now.getTime()) / 1000);
	if (totalSeconds <= 0) return null;

	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (n: number) => n.toString().padStart(2, '0');

	return days > 0
		? `${days}d ${pad(hours)}h ${pad(minutes)}m`
		: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// Converts a <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm", no
// timezone of its own) into the true UTC instant its browser's user
// actually entered. Never do this via `new Date(value)` on the server:
// per the ECMA-262 date-time string grammar, a date-time with no offset
// is parsed using the *executing runtime's* own local timezone — correct
// only when server and browser happen to share one (true for most local
// dev, which is why this class of bug goes uncaught there), wrong
// wherever they don't (e.g. a UTC-timezone production server and a
// browser anywhere else — confirmed as the actual cause of a real report:
// entering 07/14 12:00 AM in MDT silently stored as 07/14 00:00 UTC
// instead of 07/14 06:00 UTC, six hours/one calendar day off).
// tzOffsetMinutes must come from the browser itself
// (`new Date().getTimezoneOffset()`, submitted alongside the raw value —
// the server has no other way to know it) and follows that method's own
// sign convention (positive when local is behind UTC). Returns null for a
// malformed or empty value.
export function localDateTimeToUtcIso(value: string, tzOffsetMinutes: number): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
	if (!match) return null;
	const [year, month, day, hour, minute] = match.slice(1).map(Number);
	const utcMs = Date.UTC(year, month - 1, day, hour, minute) + tzOffsetMinutes * 60000;
	return new Date(utcMs).toISOString();
}
