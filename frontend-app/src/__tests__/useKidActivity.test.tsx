import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useKidActivity('c1'), { wrapper });
}

beforeEach(() => {
  mockActivity.mockReset().mockResolvedValue(empty);
  mockSend.mockReset();
  mockToastError.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useKidActivity', () => {
  it("reads the child's activity for their own day", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.activity).toEqual(empty));
    expect(mockActivity).toHaveBeenCalledWith('c1', localDay());
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
