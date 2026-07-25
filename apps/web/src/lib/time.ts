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
// same format the /auction/silent countdown already uses, generalized here
// so this dashboard's own phase countdown doesn't duplicate it.
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
