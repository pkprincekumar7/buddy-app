import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Child } from '@/api/children';

const mockNavigate = jest.fn();
jest.mock('@/lib/router', () => ({
  navigate: (...a: unknown[]) => mockNavigate(...a),
}));
// A child the list shows in setup is asked for afresh on its row's press.
const mockGet = jest.fn();
jest.mock('@/api/children', () => ({
  ...jest.requireActual<typeof import('@/api/children')>('@/api/children'),
  children: { get: (id: string) => mockGet(id) },
}));

import ProfileChildren from '@/components/shared/ProfileChildren';

const child = (id: string, name: string, done = true, age = 9) =>
  ({
    id,
    name,
    age,
    avatar_url: null,
    progress: { conversation: done },
  } as unknown as Child);

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach(c => c.clear()));

function setup(
  overrides: Partial<React.ComponentProps<typeof ProfileChildren>> = {},
) {
  const props: React.ComponentProps<typeof ProfileChildren> = {
    list: [child('a', 'Aarav'), child('b', 'Meera', false)],
    isLoading: false,
    isLoadingError: false,
    isFetching: false,
    onRetry: jest.fn(),
    currentChildId: 'a',
    onClose: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  };
  // No garbage-collection timer (gcTime), so nothing keeps Jest running after the tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return {
    props,
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProfileChildren {...props} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mockNavigate.mockReset();
  // By default the server agrees with the list: Meera is still in setup.
  mockGet
    .mockReset()
    .mockImplementation((id: string) =>
      Promise.resolve(child(id, id === 'b' ? 'Meera' : 'Aarav', id !== 'b')),
    );
});

describe('ProfileChildren', () => {
  it('lists each child with their age, or that they are setting up', () => {
    const { getByLabelText } = setup();
    expect(getByLabelText('Aarav, Child · age 9')).toBeTruthy();
    expect(getByLabelText('Meera, Child · setting up')).toBeTruthy();
  });

  it('marks the child whose page is open', () => {
    const { getByLabelText } = setup();
    expect(
      getByLabelText('Aarav, Child · age 9').props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
    expect(
      getByLabelText('Meera, Child · setting up').props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: false }));
  });

  it('without child view, opens a finished child at the journey, and one in setup at the form', async () => {
    const { getByLabelText, props } = setup();
    fireEvent.press(getByLabelText('Aarav, Child · age 9'));
    expect(props.onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenLastCalledWith('/PersonalityJourney/a'),
    );
    expect(mockGet).not.toHaveBeenCalled(); // a finished child opens without asking
    fireEvent.press(getByLabelText('Meera, Child · setting up'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenLastCalledWith('/Onboarding/b'),
    );
  });

  it("opens a child's profile form from its pencil, whatever its progress", () => {
    const { getByLabelText, props } = setup();
    fireEvent.press(getByLabelText("Edit Aarav's profile"));
    expect(props.onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenLastCalledWith('/Onboarding/a');
    fireEvent.press(getByLabelText("Edit Meera's profile"));
    expect(mockNavigate).toHaveBeenLastCalledWith('/Onboarding/b');
  });

  it('asks to delete a child from its ×, closing the menu first', () => {
    const { getByLabelText, props } = setup();
    fireEvent.press(getByLabelText('Delete Meera'));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onDelete).toHaveBeenCalledWith(props.list[1]);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("switches to a finished child's child view from its row; one in setup opens the form", async () => {
    const onChildView = jest.fn();
    const { getByLabelText, props } = setup({ onChildView });
    fireEvent.press(getByLabelText('Aarav, Child · age 9'));
    expect(props.onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(onChildView).toHaveBeenCalledWith(props.list[0]),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Meera, Child · setting up'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenLastCalledWith('/Onboarding/b'),
    );
    expect(onChildView).toHaveBeenCalledTimes(1);
  });

  it('opens child view for a child whose chat finished after the list was fetched', async () => {
    mockGet.mockResolvedValue(child('b', 'Meera', true));
    const onChildView = jest.fn();
    const { getByLabelText, client } = setup({ onChildView });
    client.setQueryData(
      ['children'],
      [child('a', 'Aarav'), child('b', 'Meera', false)],
    );
    fireEvent.press(getByLabelText('Meera, Child · setting up'));
    await waitFor(() =>
      expect(onChildView).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b', progress: { conversation: true } }),
      ),
    );
    expect(mockGet).toHaveBeenCalledWith('b');
    expect(mockNavigate).not.toHaveBeenCalled();
    // The cached list is updated too, so the menu shows Meera as done.
    const cached = client.getQueryData<Child[]>(['children']);
    expect(cached?.find(c => c.id === 'b')?.progress.conversation).toBe(true);
  });

  it('ignores a second press while a child is being checked', async () => {
    const onChildView = jest.fn();
    const { getByLabelText, props } = setup({ onChildView });
    const row = getByLabelText('Meera, Child · setting up');
    fireEvent.press(row);
    fireEvent.press(row);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenLastCalledWith('/Onboarding/b'),
    );
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('opens what the list says when the fresh fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    const onChildView = jest.fn();
    const { getByLabelText } = setup({ onChildView });
    fireEvent.press(getByLabelText('Meera, Child · setting up'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenLastCalledWith('/Onboarding/b'),
    );
    expect(onChildView).not.toHaveBeenCalled();
  });

  it('adds a child through onboarding with forceNew', () => {
    const { getByLabelText, props } = setup();
    fireEvent.press(getByLabelText('Add Child'));
    expect(props.onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/Onboarding', {
      state: { forceNew: true },
    });
  });

  it('disables Add Child at the limit of 10', () => {
    const list = Array.from({ length: 10 }, (_, i) =>
      child(String(i), `Child ${i}`),
    );
    const { getByLabelText, getByText } = setup({ list });
    const add = getByLabelText('Add Child');
    expect(add.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(add);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getByText('Maximum of 10 children')).toBeTruthy();
  });

  it('still offers Add Child with no children', () => {
    const { getByLabelText, queryByLabelText } = setup({ list: [] });
    expect(getByLabelText('Add Child')).toBeTruthy();
    expect(queryByLabelText(/^Delete /)).toBeNull();
  });

  it('shows loading, and a retry when the list fails', () => {
    expect(
      setup({ isLoading: true }).getByText('Loading your children…'),
    ).toBeTruthy();
    const { getByLabelText, getByText, props } = setup({
      isLoadingError: true,
    });
    expect(getByText("Couldn't load your children.")).toBeTruthy();
    fireEvent.press(getByLabelText('Try again'));
    expect(props.onRetry).toHaveBeenCalled();
  });
});
