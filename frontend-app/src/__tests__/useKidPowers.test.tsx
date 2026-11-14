import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

const mockPowers = jest.fn();
jest.mock('@/api/discover', () => ({
  ...jest.requireActual<object>('@/api/discover'),
  discover: { powers: (...a: unknown[]) => mockPowers(...a) },
}));

import { useKidPowers } from '@/hooks/useKidPowers';

function setup(childId: string | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useKidPowers(childId), { wrapper });
}

beforeEach(() => mockPowers.mockReset());

describe('useKidPowers', () => {
  it("reads the child's powers", async () => {
    mockPowers.mockResolvedValue({ style: 'Thinker', powers: [] });
    const { result } = setup('c1');
    await waitFor(() => expect(result.current.powers).not.toBeNull());
    expect(mockPowers).toHaveBeenCalledWith('c1');
    expect(result.current.notReady).toBe(false);
  });

  it('says not ready, without retrying, while the personality is being made', async () => {
    mockPowers.mockRejectedValue(
      new ApiError(404, { code: 'personality_not_ready', msg: 'Not yet.' }),
    );
    const { result } = setup('c1');
    await waitFor(() => expect(result.current.notReady).toBe(true));
    expect(mockPowers).toHaveBeenCalledTimes(1);
    expect(result.current.powers).toBeNull();
  });

  it('reads nothing without a child (another tab)', () => {
    setup(undefined);
    expect(mockPowers).not.toHaveBeenCalled();
  });
});
