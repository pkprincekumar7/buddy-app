import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

const mockActivity = jest.fn();
const mockSend = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/api/kids', () => ({
  ...jest.requireActual<object>('@/api/kids'),
  kids: {
    activity: (...a: unknown[]) => mockActivity(...a),
    send: (...a: unknown[]) => mockSend(...a),
  },
}));
jest.mock('@/lib/toast', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a) },
}));

import { useKidActivity } from '@/hooks/useKidActivity';
import { localDay } from '@/lib/kidsDay';

const empty = {
  stars: 0,
  circles_done: {
    discover: false,
    grow: false,
    transform: false,
    release: false,
    connect: false,
  },
  flipped_powers: [],
  discover_badge: false,
  tried_today: [],
  best_times: {},
  moods: {},
};

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useKidActivity('c1'), { wrapper }) };
}

beforeEach(() => {
  mockActivity.mockReset().mockResolvedValue(empty);
  mockSend.mockReset();
  mockToastError.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  clients.splice(0).forEach(client => client.clear()); // no gc timers left running
});

describe('useKidActivity', () => {
  it("reads the child's activity for their own day", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.activity).toEqual(empty));
    expect(mockActivity).toHaveBeenCalledWith('c1', localDay());
  });

  it('re-reads until progress from grow or transform shows, then stops', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.activity).not.toBeNull());
    const grown = {
      ...empty,
      circles_done: { ...empty.circles_done, grow: true },
    };
    // The event hasn't arrived on the first re-read; it has on the next.
    mockActivity.mockResolvedValueOnce(empty).mockResolvedValue(grown);
    act(() => result.current.awaitProgress(a => a.circles_done.grow));
    await waitFor(
      () => expect(result.current.activity?.circles_done.grow).toBe(true),
      { timeout: 4000 },
    );
    const reads = mockActivity.mock.calls.length;
    await new Promise<void>(r => setTimeout(() => r(), 1500));
    expect(mockActivity.mock.calls.length).toBe(reads); // done: no more re-reads
  });

  describe('when the progress is slow to show', () => {
    const grown = {
      ...empty,
      circles_done: { ...empty.circles_done, grow: true },
    };
    beforeEach(() => {
      jest.useFakeTimers();
      // react-query notifies on a real setTimeout(0), which fake timers never run: a microtask instead.
      notifyManager.setScheduler(cb => void Promise.resolve().then(cb));
    });
    afterEach(() => {
      notifyManager.setScheduler(defaultScheduler);
      jest.useRealTimers();
    });
    const advance = (ms: number) =>
      act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    async function expecting() {
      const hook = setup();
      await advance(0);
      expect(hook.result.current.activity).toEqual(empty);
      act(() => hook.result.current.awaitProgress(a => a.circles_done.grow));
      await advance(0);
      return hook;
    }

    it('stops re-reading at the deadline even when the reads fail', async () => {
      await expecting();
      mockActivity.mockRejectedValue(
        new ApiError(503, { code: 'x', msg: 'Down.' }),
      );
      const start = mockActivity.mock.calls.length;
      await advance(15_000); // the fast phase: each second
      const fast = mockActivity.mock.calls.length - start;
      expect(fast).toBeGreaterThanOrEqual(14);
      await advance(105_000); // the slow phase: every 5 s, to 2 minutes in all
      const slow = mockActivity.mock.calls.length - start - fast;
      expect(slow).toBeGreaterThanOrEqual(20);
      expect(slow).toBeLessThanOrEqual(21);
      const reads = mockActivity.mock.calls.length;
      await advance(60_000);
      expect(mockActivity.mock.calls.length).toBe(reads);
    });

    it('keeps re-reading more slowly after the fast phase, until the progress shows', async () => {
      const { result } = await expecting();
      await advance(15_000);
      const reads = mockActivity.mock.calls.length;
      await advance(4000);
      expect(mockActivity.mock.calls.length).toBe(reads); // not each second any more
      mockActivity.mockResolvedValue(grown);
      await advance(1000);
      expect(mockActivity.mock.calls.length).toBe(reads + 1);
      expect(result.current.activity?.circles_done.grow).toBe(true);
      await advance(30_000);
      expect(mockActivity.mock.calls.length).toBe(reads + 1); // shown: no more re-reads
    });

    it('gives up after two minutes, leaving the activity to read again', async () => {
      const { client } = await expecting();
      await advance(120_000);
      const reads = mockActivity.mock.calls.length;
      await advance(60_000);
      expect(mockActivity.mock.calls.length).toBe(reads);
      expect(
        client.getQueryCache().find({ queryKey: ['kids', 'c1'], exact: false })
          ?.state.isInvalidated,
      ).toBe(true);
    });
  });

  it("shows the server's answer after a send", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.activity).not.toBeNull());
    mockSend.mockResolvedValue({ ...empty, stars: 1 });
    await act(async () => {
      await result.current.send({ type: 'flip_power', power: 0 });
    });
    expect(mockSend).toHaveBeenCalledWith('c1', localDay(), {
      type: 'flip_power',
      power: 0,
    });
    expect(result.current.activity?.stars).toBe(1);
  });

  it('says why a send failed, and keeps what was shown', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.activity).not.toBeNull());
    mockSend.mockRejectedValue(
      new ApiError(403, { code: 'circle_locked', msg: 'Locked.' }),
    );
    let answer: unknown = 'unset';
    await act(async () => {
      answer = await result.current.send({ type: 'mood', mood: 'good' });
    });
    expect(answer).toBeNull();
    expect(mockToastError).toHaveBeenCalledWith(
      'This one opens later. Keep going!',
    );
    expect(result.current.activity).toEqual(empty);
  });
});
