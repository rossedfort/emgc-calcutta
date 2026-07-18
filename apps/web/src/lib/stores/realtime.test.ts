import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createTournamentRealtime } from './realtime';

// A minimal stand-in for the chainable supabase-js query builder — every
// select() this module makes (players/live_lots/bids) terminates at either
// .eq() or .in().order(), so both are wired to resolve empty data.
function createSupabaseMock() {
	const chain = {
		eq: vi.fn(() => Promise.resolve({ data: [] })),
		in: vi.fn(() => ({ order: vi.fn(() => Promise.resolve({ data: [] })) }))
	};
	const from = vi.fn(() => ({ select: vi.fn(() => chain) }));

	let subscribeCallback: ((status: string) => void) | undefined;
	const channel = {
		on: vi.fn(() => channel),
		subscribe: vi.fn((cb: (status: string) => void) => {
			subscribeCallback = cb;
			return channel;
		})
	};

	const supabase = {
		channel: vi.fn(() => channel),
		from,
		removeChannel: vi.fn()
	};

	return {
		supabase,
		from,
		// Fires the same callback realtime-js invokes on join/rejoin/drop —
		// this is the exact seam createTournamentRealtime's reconnect
		// handling lives behind, so tests drive it directly rather than
		// standing up a real websocket.
		emit: (status: string) => subscribeCallback?.(status)
	};
}

describe('createTournamentRealtime connection status', () => {
	it('starts as connecting before the channel ever joins', () => {
		const { supabase } = createSupabaseMock();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rt = createTournamentRealtime(supabase as any, 't1');
		expect(get(rt.connectionStatus)).toBe('connecting');
	});

	it('becomes connected and reconciles on the initial SUBSCRIBED', async () => {
		const { supabase, from, emit } = createSupabaseMock();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rt = createTournamentRealtime(supabase as any, 't1');

		emit('SUBSCRIBED');
		await Promise.resolve();
		await Promise.resolve();

		expect(get(rt.connectionStatus)).toBe('connected');
		expect(from).toHaveBeenCalledWith('players');
		expect(from).toHaveBeenCalledWith('live_lots');
	});

	it.each(['TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR'])(
		'moves to reconnecting on %s after having been connected',
		async (status) => {
			const { supabase, emit } = createSupabaseMock();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const rt = createTournamentRealtime(supabase as any, 't1');

			emit('SUBSCRIBED');
			await Promise.resolve();
			expect(get(rt.connectionStatus)).toBe('connected');

			emit(status);
			expect(get(rt.connectionStatus)).toBe('reconnecting');
		}
	);

	it('recovers to connected and re-reconciles on a rejoin after a drop', async () => {
		const { supabase, from, emit } = createSupabaseMock();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rt = createTournamentRealtime(supabase as any, 't1');

		emit('SUBSCRIBED');
		await Promise.resolve();
		await Promise.resolve();
		const callsAfterFirstJoin = from.mock.calls.length;

		emit('CHANNEL_ERROR');
		expect(get(rt.connectionStatus)).toBe('reconnecting');

		// realtime-js's own rejoin logic (not app code) re-fires SUBSCRIBED
		// once the underlying socket recovers — this is what an app-visible
		// "auto re-sync on recovery" actually looks like from this module's
		// perspective.
		emit('SUBSCRIBED');
		await Promise.resolve();
		await Promise.resolve();

		expect(get(rt.connectionStatus)).toBe('connected');
		expect(from.mock.calls.length).toBeGreaterThan(callsAfterFirstJoin);
	});

	it('destroy() removes the channel', () => {
		const { supabase } = createSupabaseMock();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rt = createTournamentRealtime(supabase as any, 't1');
		rt.destroy();
		expect(supabase.removeChannel).toHaveBeenCalled();
	});
});
