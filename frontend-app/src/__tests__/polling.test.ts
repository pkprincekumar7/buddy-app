import { ApiError } from '@/api/errors';
import {
  MAX_INTERVAL_MS,
  isRateLimited,
  pause,
  runJob,
  slower,
} from '@/api/polling';

// JOB-05: polls slow down, and a 429 waits and polls again instead of failing.

describe('slower', () => {
  it('waits half as long again each time, up to the cap', () => {
    const waits = [2000];
    for (let i = 0; i < 5; i++) waits.push(slower(waits[waits.length - 1]!));
    expect(waits).toEqual([2000, 3000, 4500, 5000, 5000, 5000]);
    expect(MAX_INTERVAL_MS).toBe(5000);
  });

  it('keeps a wait that is already past the cap', () => {
    expect(slower(60_000)).toBe(60_000);
    expect(slower(1, 4)).toBe(2);
  });
});

describe('runJob', () => {
  const start = async () => ({ job_id: 'j1' });

  it('polls again after a 429 and finishes the job', async () => {
    const answers: Array<{ status: string } | Error> = [
      { status: 'processing' },
      new ApiError(429, 'Too many requests'),
      { status: 'completed' },
    ];
    const poll = jest.fn(async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    await expect(
      runJob(start, poll, { intervalMs: 1, maxIntervalMs: 2 }),
    ).resolves.toBe('completed');
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('still fails on any other error', async () => {
    const poll = jest.fn(async () => {
      throw new ApiError(500, 'boom');
    });
    await expect(runJob(start, poll, { intervalMs: 1 })).rejects.toMatchObject({
      status: 500,
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('gives up at the deadline, even while rate limited', async () => {
    const poll = jest.fn(async () => {
      throw new ApiError(429, 'Too many requests');
    });
    await expect(
      runJob(start, poll, { intervalMs: 1, maxIntervalMs: 1, timeoutMs: 20 }),
    ).rejects.toThrow('taking too long');
  });
});

describe('isRateLimited', () => {
  it('is a 429 ApiError only', () => {
    expect(isRateLimited(new ApiError(429, 'x'))).toBe(true);
    expect(isRateLimited(new ApiError(503, 'x'))).toBe(false);
    expect(isRateLimited(new Error('429'))).toBe(false);
  });
});

describe('pause', () => {
  it('removes its abort listener once the wait ends', async () => {
    const controller = new AbortController();
    const add = jest.spyOn(controller.signal, 'addEventListener');
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    await pause(1, controller.signal);
    await pause(1, controller.signal);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);
  });

  it('rejects with an AbortError when the signal aborts', async () => {
    const controller = new AbortController();
    const waiting = pause(10_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
