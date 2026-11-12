import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Child } from '@/api/children';

let mockAuth: {
  user: { id: string; role: string } | null;
  isLoadingAuth: boolean;
  authError?: { type: string; message: string } | null;
};
let mockKids: { list: Child[]; isLoading: boolean; isLoadingError: boolean };
jest.mock('@/lib/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@/hooks/useChildren', () => ({ useChildren: () => mockKids }));

import { ViewModeProvider, useViewMode } from '@/lib/ViewModeContext';

const KEY = 'superpower.view';
const kid = (id: string) => ({ id } as unknown as Child);
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ViewModeProvider>{children}</ViewModeProvider>
);
const setup = async () => {
  const hook = renderHook(() => useViewMode(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
};

beforeEach(async () => {
  mockAuth = { user: { id: 'u1', role: 'parent' }, isLoadingAuth: false };
  mockKids = { list: [kid('a')], isLoading: false, isLoadingError: false };
  await AsyncStorage.removeItem(KEY);
});

describe('ViewModeProvider', () => {
  it('starts in parent view', async () => {
    const { result } = await setup();
    expect(result.current.view).toEqual({ mode: 'parent' });
  });

  it('switches to child view and back, keeping it on the device', async () => {
    const { result } = await setup();
    act(() => result.current.enterChildView('a'));
    expect(result.current.view).toEqual({ mode: 'child', childId: 'a' });
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null')).toEqual({
      userId: 'u1',
      childId: 'a',
    });
    act(() => result.current.exitChildView());
    expect(result.current.view).toEqual({ mode: 'parent' });
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('reopens in child view after a restart', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ userId: 'u1', childId: 'a' }),
    );
    const { result } = await setup();
    expect(result.current.view).toEqual({ mode: 'child', childId: 'a' });
  });

  it("forgets another account's child view", async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ userId: 'u2', childId: 'a' }),
    );
    const { result } = await setup();
    expect(result.current.view).toEqual({ mode: 'parent' });
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(KEY)).toBeNull(),
    );
  });

  it('forgets it on sign-out', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ userId: 'u1', childId: 'a' }),
    );
    const { result, rerender } = await setup();
    expect(result.current.view.mode).toBe('child');
    mockAuth = { user: null, isLoadingAuth: false };
    rerender({});
    await waitFor(() => expect(result.current.view.mode).toBe('parent'));
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('keeps it when the sign-in check fails (offline, a 5xx)', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ userId: 'u1', childId: 'a' }),
    );
    const { rerender } = await setup();
    mockAuth = {
      user: null,
      isLoadingAuth: false,
      authError: { type: 'unknown', message: 'Network error' },
    };
    rerender({});
    // Then the retry succeeds: still the same child's view.
    mockAuth = { user: { id: 'u1', role: 'parent' }, isLoadingAuth: false };
    rerender({});
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
  });

  it('keeps it while auth is still loading', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ userId: 'u1', childId: 'a' }),
    );
    mockAuth = { user: null, isLoadingAuth: true };
    await setup();
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
  });

  it('goes back to parent view when the child is gone', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ userId: 'u1', childId: 'gone' }),
    );
    const { result } = await setup();
    await waitFor(() => expect(result.current.view.mode).toBe('parent'));
  });

  it('waits for the children list before deciding the child is gone', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ userId: 'u1', childId: 'a' }),
    );
    mockKids = { list: [], isLoading: true, isLoadingError: false };
    const { result } = await setup();
    expect(result.current.view).toEqual({ mode: 'child', childId: 'a' });
  });

  it('stays in parent view for an admin', async () => {
    mockAuth = { user: { id: 'u1', role: 'admin' }, isLoadingAuth: false };
    const admin = await setup();
    act(() => admin.result.current.enterChildView('a'));
    expect(admin.result.current.view.mode).toBe('parent');
  });
});
