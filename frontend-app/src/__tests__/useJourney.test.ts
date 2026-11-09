import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockChildGet = jest.fn();
const mockPersonality = jest.fn();
const mockSettle = jest.fn();
jest.mock('@/api/children', () => ({
  children: { get: (...a: unknown[]) => mockChildGet(...a) },
}));
jest.mock('@/api/discover', () => ({
  discover: { personality: (...a: unknown[]) => mockPersonality(...a) },
  settlePersonality: (...a: unknown[]) => mockSettle(...a),
  DISCOVER_ERRORS: {},
}));

import { useJourney } from '@/hooks/useJourney';

describe('useJourney', () => {
  it('resets the journey and the retry count when the child changes', async () => {
    mockChildGet.mockImplementation((id: string) => Promise.resolve({ id }));
    mockPersonality.mockResolvedValue({ status: 'generating' });
    mockSettle.mockResolvedValue({ status: 'failed' });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useJourney(id, true),
      { initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(result.current.journey.status).toBe('failed'));
    act(() => result.current.retry());
    await waitFor(() =>
      expect(mockSettle).toHaveBeenLastCalledWith(
        'a',
        expect.objectContaining({ retry: true }),
      ),
    );
    await waitFor(() => expect(result.current.journey.status).toBe('failed'));

    // Child b never resolves, so we can see the reset state.
    mockChildGet.mockImplementation(() => new Promise(() => {}));
    rerender({ id: 'b' });
    expect(result.current.journey).toEqual({ status: 'loading' });

    mockChildGet.mockImplementation((id: string) => Promise.resolve({ id }));
    mockSettle.mockClear();
    rerender({ id: 'c' });
    await waitFor(() => expect(mockSettle).toHaveBeenCalled());
    expect(mockSettle).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({ retry: false }),
    );
  });
});
