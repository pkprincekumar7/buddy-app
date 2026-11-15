import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

const mockRemove = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/api/children', () => ({
  children: { remove: (...a: unknown[]) => mockRemove(...a) },
}));
jest.mock('@/lib/toast', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a) },
}));

import { useDeleteChild } from '@/hooks/useDeleteChild';

function setup() {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useDeleteChild(), { wrapper });
  return { result, invalidate };
}

beforeEach(() => {
  mockRemove.mockReset();
  mockToastError.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useDeleteChild', () => {
  it('deletes the child and refreshes the children list', async () => {
    mockRemove.mockResolvedValue(undefined);
    const { result, invalidate } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.deleteChild('a');
    });
    expect(ok).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith('a');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['children'] });
    expect(result.current.deletingId).toBeNull();
  });

  it('counts a child that is already gone (404) as deleted', async () => {
    mockRemove.mockRejectedValue(new ApiError(404, 'Not found'));
    const { result, invalidate } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.deleteChild('a');
    });
    expect(ok).toBe(true);
    expect(invalidate).toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('reports any other failure and keeps the list as it is', async () => {
    mockRemove.mockRejectedValue(new ApiError(500, 'Server error'));
    const { result, invalidate } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.deleteChild('a', 'Could not start over.');
    });
    expect(ok).toBe(false);
    expect(mockToastError).toHaveBeenCalledWith('Could not start over.');
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.deletingId).toBeNull();
  });
});
