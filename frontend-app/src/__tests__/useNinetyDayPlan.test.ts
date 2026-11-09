import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockPatch = jest.fn(() => Promise.resolve({}));
jest.mock('@/api/transform', () => ({
  transform: {
    get: (...a: unknown[]) => mockGet(...a),
    patch: (...a: unknown[]) => mockPatch(...(a as [])),
    uploadPhoto: jest.fn(),
  },
  runTransformGeneration: jest.fn(() => Promise.resolve('completed')),
  TRANSFORM_ERRORS: {},
}));
jest.mock('@/lib/toast', () => ({ toast: { error: jest.fn() } }));

import { useNinetyDayPlan } from '@/hooks/useNinetyDayPlan';
import { runTransformGeneration } from '@/api/transform';

const savedDoc = {
  ask: 'saved',
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
};

describe('useNinetyDayPlan', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGet.mockReset();
    mockPatch.mockClear();
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
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockPatch).not.toHaveBeenCalled();
    expect(runTransformGeneration).not.toHaveBeenCalled();

    mockGet.mockResolvedValueOnce(savedDoc);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loadFailed).toBe(false));
    act(() => result.current.toggleApplied('a1'));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockPatch).toHaveBeenCalledWith('c1', { applied: { a1: true } });
  });
});
