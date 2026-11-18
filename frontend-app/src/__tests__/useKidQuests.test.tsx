import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

const mockGet = jest.fn();
const mockLog = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/api/kidQuests', () => ({
  ...jest.requireActual<object>('@/api/kidQuests'),
  kidQuests: {
    get: (...a: unknown[]) => mockGet(...a),
    pick: jest.fn(),
    log: (...a: unknown[]) => mockLog(...a),
  },
}));
jest.mock('@/lib/toast', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a) },
}));

import { useKidQuests } from '@/hooks/useKidQuests';

const state = (logs: Record<string, number>) => ({
  default_interest: 'music',
  interests: [],
  current: null,
  logs,
  last_logged: {},
  logged_today: [],
  catalog: [],
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useKidQuests('c1'), { wrapper });
}

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(state({}));
  mockLog.mockReset();
  mockToastError.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useKidQuests', () => {
  it("says when a log was the quest's first, and keeps the server's answer", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.quests).not.toBeNull());
    mockLog.mockResolvedValue(state({ 'music:0': 1 }));
    let first = false;
    await act(async () => {
      first = await result.current.log('music', 0);
    });
    expect(first).toBe(true);
    expect(result.current.quests?.logs).toEqual({ 'music:0': 1 });

    mockLog.mockResolvedValue(state({ 'music:0': 2 }));
    await act(async () => {
      first = await result.current.log('music', 0);
    });
    expect(first).toBe(false);
  });

  it('says why a log failed', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.quests).not.toBeNull());
    mockLog.mockRejectedValue(
      new ApiError(409, { code: 'interest_not_picked', msg: 'No.' }),
    );
    let first = true;
    await act(async () => {
      first = await result.current.log('space', 0);
    });
    expect(first).toBe(false);
    expect(mockToastError).toHaveBeenCalledWith('Pick this one first.');
  });
});
