import { describe, expect, it } from 'vitest';
import { formatCountdown, formatRelativeTime } from './time';

describe('formatRelativeTime', () => {
	const now = new Date('2026-01-01T12:00:00Z');

	it('returns "Just now" for anything under a minute', () => {
		expect(formatRelativeTime(new Date('2026-01-01T11:59:31Z'), now)).toBe('Just now');
	});

	it('formats minutes, singular and plural', () => {
		expect(formatRelativeTime(new Date('2026-01-01T11:59:00Z'), now)).toBe('1 minute ago');
		expect(formatRelativeTime(new Date('2026-01-01T11:15:00Z'), now)).toBe('45 minutes ago');
	});

	it('formats hours once past 60 minutes', () => {
		expect(formatRelativeTime(new Date('2026-01-01T11:00:00Z'), now)).toBe('1 hour ago');
		expect(formatRelativeTime(new Date('2026-01-01T09:00:00Z'), now)).toBe('3 hours ago');
	});

	it('formats days once past 24 hours', () => {
		expect(formatRelativeTime(new Date('2025-12-31T12:00:00Z'), now)).toBe('1 day ago');
		expect(formatRelativeTime(new Date('2025-12-29T12:00:00Z'), now)).toBe('3 days ago');
	});
});

describe('formatCountdown', () => {
	const now = new Date('2026-01-01T12:00:00Z');

	it('returns null once the target has passed', () => {
		expect(formatCountdown(new Date('2026-01-01T11:59:59Z'), now)).toBeNull();
	});

	it('formats hh:mm:ss within the final day', () => {
		expect(formatCountdown(new Date('2026-01-01T13:02:03Z'), now)).toBe('01:02:03');
	});

	it('formats "Nd HHh MMm" once more than a day out', () => {
		expect(formatCountdown(new Date('2026-01-03T14:30:00Z'), now)).toBe('2d 02h 30m');
	});
});
