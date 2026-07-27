import { describe, expect, it } from 'vitest';
import { formatCountdown, formatRelativeTime, localDateTimeToUtcIso } from './time';

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

describe('localDateTimeToUtcIso', () => {
	it('applies a positive offset (behind UTC, e.g. MDT) — the actual reported bug', () => {
		// 07/14 12:00 AM MDT must land on 07/14 06:00 UTC, not silently stored
		// as 07/14 00:00 UTC (which reads back as 07/13 6:00 PM MDT).
		expect(localDateTimeToUtcIso('2026-07-14T00:00', 360)).toBe('2026-07-14T06:00:00.000Z');
	});

	it('applies a negative offset (ahead of UTC)', () => {
		expect(localDateTimeToUtcIso('2026-07-14T10:00', -330)).toBe('2026-07-14T04:30:00.000Z');
	});

	it('passes through unchanged for a zero offset (UTC)', () => {
		expect(localDateTimeToUtcIso('2026-07-14T10:00', 0)).toBe('2026-07-14T10:00:00.000Z');
	});

	it('rolls over the calendar day/month/year when the offset crosses midnight', () => {
		expect(localDateTimeToUtcIso('2026-12-31T23:00', 120)).toBe('2027-01-01T01:00:00.000Z');
		expect(localDateTimeToUtcIso('2026-01-01T01:00', -120)).toBe('2025-12-31T23:00:00.000Z');
	});

	it('returns null for malformed or empty input', () => {
		expect(localDateTimeToUtcIso('', 360)).toBeNull();
		expect(localDateTimeToUtcIso('not-a-date', 360)).toBeNull();
	});
});
