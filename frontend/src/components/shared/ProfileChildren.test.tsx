import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as Router from 'react-router';
import type * as ChildrenApi from '@/api/children';
import type { Child } from '@/api/children';

// vi.mock runs before the imports, so what the mocks call is made with vi.hoisted.
const { navigate, get } = vi.hoisted(() => ({
  navigate: vi.fn(),
  // A row the list shows in setup asks for that child afresh.
  get: vi.fn<(id: string) => Promise<Child>>(),
}));
vi.mock('react-router', async (importActual) => ({
  ...(await importActual<typeof Router>()),
  useNavigate: () => navigate,
}));
vi.mock('@/api/children', async (importActual) => ({
  ...(await importActual<typeof ChildrenApi>()),
  children: { get: (id: string) => get(id) },
}));

import ProfileChildren, { ChildAvatar } from '@/components/shared/ProfileChildren';

const child = (id: string, name: string, done = true, age = 9) =>
  ({ id, name, age, avatar_url: null, progress: { conversation: done } }) as unknown as Child;

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((c) => c.clear()));

function setup(overrides: Partial<Parameters<typeof ProfileChildren>[0]> = {}) {
  const props = {
    list: [child('a', 'Aarav'), child('b', 'Meera', false)],
    isLoading: false,
    isLoadingError: false,
    isFetching: false,
    onRetry: vi.fn(),
    currentChildId: 'a',
    onClose: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrap = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  render(<ProfileChildren {...props} />, { wrapper: wrap });
  return { props, client, user: userEvent.setup() };
}

// A child's row: its name is the initial, the name, then "Child · …".
const row = (name: string) =>
  screen.getByRole('button', { name: (accessible) => accessible.includes(`${name}Child`) });

beforeEach(() => {
  navigate.mockReset();
  // The server agrees with the list by default: Meera is still in setup.
  get.mockReset().mockImplementation((id) => Promise.resolve(child(id, 'Meera', false)));
});

describe('ProfileChildren', () => {
  it('lists each child with their age, or that they are setting up', () => {
    setup();
    expect(screen.getByText('Child · age 9')).toBeInTheDocument();
    expect(screen.getByText('Child · setting up')).toBeInTheDocument();
    expect(row('Aarav')).toHaveAttribute('aria-current', 'page');
    expect(row('Meera')).not.toHaveAttribute('aria-current');
  });

  it("opens a finished child's child view, without asking the server", async () => {
    const onChildView = vi.fn();
    const { props, user } = setup({ onChildView });
    await user.click(row('Aarav'));
    expect(onChildView).toHaveBeenCalledWith(props.list[0]);
    expect(props.onClose).toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens child view for a child whose chat finished after the list was fetched', async () => {
    get.mockResolvedValue(child('b', 'Meera', true));
    const onChildView = vi.fn();
    const { client, user } = setup({ onChildView });
    client.setQueryData(['children'], [child('a', 'Aarav'), child('b', 'Meera', false)]);
    await user.click(row('Meera'));
    await waitFor(() =>
      expect(onChildView).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b', progress: { conversation: true } }),
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
    // The cached list is updated too, so the menu shows Meera as done.
    const cached = client.getQueryData<Child[]>(['children']);
    expect(cached?.find((c) => c.id === 'b')?.progress.conversation).toBe(true);
  });

  it('opens the onboarding form for a child still in setup, or when the fetch fails', async () => {
    const { user } = setup({ onChildView: vi.fn() });
    await user.click(row('Meera'));
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith('/Onboarding/b'));
    get.mockRejectedValue(new Error('offline'));
    await user.click(row('Meera'));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
    expect(navigate).toHaveBeenLastCalledWith('/Onboarding/b');
  });

  it('ignores a second click while a child is being checked', async () => {
    let resolve: (c: Child) => void = () => undefined;
    get.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { props, user } = setup();
    await user.click(row('Meera'));
    await user.click(row('Meera'));
    resolve(child('b', 'Meera', false));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('edits from the pencil, deletes from the ×, and adds a child', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: "Edit Meera's profile" }));
    expect(navigate).toHaveBeenLastCalledWith('/Onboarding/b');
    await user.click(screen.getByRole('button', { name: 'Delete Meera' }));
    expect(props.onDelete).toHaveBeenCalledWith(props.list[1]);
    await user.click(screen.getByRole('button', { name: 'Add Child' }));
    expect(navigate).toHaveBeenLastCalledWith('/Onboarding', { state: { forceNew: true } });
  });

  it('disables Add Child at the limit of 10', () => {
    setup({ list: Array.from({ length: 10 }, (_, i) => child(String(i), `Child ${i}`)) });
    expect(screen.getByRole('button', { name: 'Add Child' })).toBeDisabled();
    expect(screen.getByText('Maximum of 10 children')).toBeInTheDocument();
  });
});

// The child's avatar is shared: the menu's rows, the Back row's chip and child view's
// profile button (Layout), each at its own size.
describe('ChildAvatar', () => {
  it('shows the photo, at the size asked for', () => {
    const { container } = render(
      <ChildAvatar
        child={{ name: 'Asha', avatar_url: 'https://uploads.example.test/a.png' }}
        className="h-8 w-8"
      />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://uploads.example.test/a.png');
    expect(img).toHaveClass('h-8', 'w-8', 'rounded-full');
  });

  it('without a photo, the cyan dot with the initial (7 by default)', () => {
    const { container } = render(<ChildAvatar child={{ name: 'Asha', avatar_url: null }} />);
    expect(container.querySelector('img')).toBeNull();
    const dot = screen.getByText('A');
    expect(dot).toHaveClass('avatar-dot-child', 'h-7', 'w-7');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });
});
