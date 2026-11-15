import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/api/errors';

const mockGet = jest.fn();
const mockPatch = jest.fn();
jest.mock('@/api/transform', () => {
  const actual = jest.requireActual('@/api/transform');
  return {
    ...actual,
    transform: {
      get: (...a: unknown[]) => mockGet(...a),
      patch: (...a: unknown[]) => mockPatch(...a),
      uploadPhoto: jest.fn(),
    },
    runTransformGeneration: jest.fn(() => Promise.resolve('completed')),
    TRANSFORM_ERRORS: {},
  };
});
const mockToast = Object.assign(jest.fn(), { error: jest.fn() });
jest.mock('@/lib/toast', () => ({
  get toast() {
    return mockToast;
  },
}));

import { useNinetyDayPlan } from '@/hooks/useNinetyDayPlan';
import {
  rebasePlanPatch,
  runTransformGeneration,
  type TransformDoc,
} from '@/api/transform';

const savedDoc = {
  version: 3,
  ask: 'saved',
  plan: null,
  track_steps: null,
  applied: {},
  act_inputs: {},
  act_counts: {},
  feedback: {},
  photos: {},
  event_name: null,
  event_date: null,
  event_set: false,
  track_done: {},
  track_inputs: {},
  track_sittings: {},
  generating: [],
  areas: [],
  completed_at: null,
} as TransformDoc;

const doc = (fields: Partial<TransformDoc>): TransformDoc => ({
  ...savedDoc,
  ...fields,
});
const photo = (key: string) => ({ key, url: `https://s3.test/${key}` });

async function loaded() {
  const rendered = renderHook(() => useNinetyDayPlan({ childId: 'c1' }));
  await waitFor(() => expect(rendered.result.current.loadingDoc).toBe(false));
  return rendered;
}

async function settle(ms = 1000) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useNinetyDayPlan', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGet.mockReset();
    mockPatch.mockReset();
    mockToast.mockClear();
    mockToast.error.mockClear();
    (runTransformGeneration as jest.Mock).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('refuses patches and generation after a failed load, until reload succeeds', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useNinetyDayPlan({ childId: 'c1' }));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.loadError).toBeInstanceOf(Error);

    act(() => {
      result.current.setAsk('typed');
      result.current.toggleApplied('a1');
      result.current.generatePlan('typed');
    });
    await settle();
    expect(mockPatch).not.toHaveBeenCalled();
    expect(runTransformGeneration).not.toHaveBeenCalled();

    mockGet.mockResolvedValueOnce(savedDoc);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loadFailed).toBe(false));
    mockPatch.mockResolvedValueOnce(doc({ version: 4, applied: { a1: true } }));
    act(() => result.current.toggleApplied('a1'));
    await settle();
    expect(mockPatch).toHaveBeenCalledWith('c1', 3, { applied: { a1: true } });
  });

  it('saves on the version of the last response', async () => {
    mockGet.mockResolvedValueOnce(savedDoc);
    const { result } = await loaded();
    mockPatch
      .mockResolvedValueOnce(doc({ version: 4, applied: { a1: true } }))
      .mockResolvedValueOnce(doc({ version: 5 }));
    act(() => result.current.toggleApplied('a1'));
    await settle();
    act(() => result.current.toggleApplied('a2'));
    await settle();
    expect(mockPatch.mock.calls.map(call => call[1])).toEqual([3, 4]);
  });

  it('on a save from another device, reloads and saves its own change on top', async () => {
    mockGet.mockResolvedValueOnce(
      doc({ applied: { a1: true }, photos: { f: [photo('k1')] } }),
    );
    const { result } = await loaded();
    // The other device ticked a2, unticked a1 and added k2, since.
    mockGet.mockResolvedValueOnce(
      doc({
        version: 4,
        applied: { a2: true },
        photos: { f: [photo('k1'), photo('k2')] },
      }),
    );
    mockPatch
      .mockRejectedValueOnce(new ApiError(409, { code: 'plan_changed' }))
      .mockResolvedValueOnce(doc({ version: 5 }));
    act(() => {
      result.current.toggleApplied('a3');
      result.current.removePhoto('f', 0);
    });
    await settle();
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2));
    expect(mockPatch).toHaveBeenLastCalledWith('c1', 4, {
      // Its own tick on top of the other device's, its removed photo only.
      applied: { a2: true, a3: true },
      photos: { f: ['k2'] },
    });
    expect(mockToast).toHaveBeenCalledWith('Updated on another device');
    expect(result.current.applied).toEqual({ a2: true, a3: true });
    expect(result.current.photoFiles.f?.map(p => p.key)).toEqual(['k2']);
  });

  it('keeps a failed save and sends it again, with newer edits winning', async () => {
    mockGet.mockResolvedValueOnce(savedDoc);
    const { result } = await loaded();
    mockPatch
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(doc({ version: 4 }));
    act(() => result.current.setActField('k', 'first'));
    await settle();
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    act(() => result.current.setAsk('newer'));
    await settle(); // the next save carries both
    expect(mockPatch).toHaveBeenLastCalledWith('c1', 3, {
      act_inputs: { k: 'first' },
      ask: 'newer',
    });
  });

  it('retries a failed save after a pause on its own', async () => {
    mockGet.mockResolvedValueOnce(savedDoc);
    const { result } = await loaded();
    mockPatch
      .mockRejectedValueOnce(new ApiError(503, 'down'))
      .mockResolvedValueOnce(doc({ version: 4 }));
    act(() => result.current.toggleApplied('a1'));
    await settle();
    expect(mockPatch).toHaveBeenCalledTimes(1);
    await settle(2500);
    expect(mockPatch).toHaveBeenCalledTimes(2);
    expect(mockPatch).toHaveBeenLastCalledWith('c1', 3, {
      applied: { a1: true },
    });
  });

  it('never saves one child’s failed save onto the next child’s plan', async () => {
    mockGet.mockResolvedValueOnce(savedDoc);
    const { result, rerender } = renderHook(
      ({ childId }: { childId: string }) => useNinetyDayPlan({ childId }),
      { initialProps: { childId: 'c1' } },
    );
    await waitFor(() => expect(result.current.loadingDoc).toBe(false));
    let fail: (err: unknown) => void = () => {};
    mockPatch.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    act(() => result.current.toggleApplied('a1'));
    await settle(); // c1's save is on its way
    expect(mockPatch).toHaveBeenCalledWith('c1', 3, { applied: { a1: true } });

    // The screen moves to c2 (no unmount), c2's plan loads, then c1's save fails.
    mockGet.mockResolvedValueOnce(doc({ version: 7, ask: 'c2' }));
    rerender({ childId: 'c2' });
    await waitFor(() => expect(result.current.ask).toBe('c2'));
    await act(async () => fail(new ApiError(503, 'down')));
    await settle(60_000); // past every retry
    expect(mockPatch).toHaveBeenCalledTimes(1);

    // c2's own edit goes on c2's version, without c1's.
    mockPatch.mockResolvedValueOnce(doc({ version: 8 }));
    act(() => result.current.toggleApplied('b1'));
    await settle();
    expect(mockPatch).toHaveBeenLastCalledWith('c2', 7, {
      applied: { b1: true },
    });
  });
});

describe('rebasePlanPatch', () => {
  const base = doc({
    ask: 'old',
    act_counts: { a: 1, b: 1 },
    event_name: 'Show',
    event_date: '2027-01-01',
    event_set: true,
  });

  it('keeps what only this device changed, and the server where both did', () => {
    const server = doc({
      ask: 'theirs',
      act_counts: { a: 5, b: 1, c: 1 },
      event_name: 'Show',
      event_date: '2027-01-01',
      event_set: true,
    });
    expect(
      rebasePlanPatch(
        { ask: 'mine', act_counts: { a: 2, b: 2 }, event_name: 'Party' },
        base,
        server,
      ),
    ).toEqual({ act_counts: { a: 5, b: 2, c: 1 }, event_name: 'Party' });
  });

  it('drops a new event over another device’s, and what changes nothing', () => {
    const server = doc({ ...base, event_date: '2027-02-02', version: 9 });
    expect(
      rebasePlanPatch(
        {
          event_name: 'Party',
          event_set: true,
          clear_track_steps: true,
          act_counts: { a: 1, b: 1 },
        },
        base,
        server,
      ),
    ).toEqual({});
  });
});
