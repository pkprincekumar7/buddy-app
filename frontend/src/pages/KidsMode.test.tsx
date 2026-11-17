import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

// Connect in child view builds its wins from the activity, the quests and the worlds; these
// tests drive the page with each source loaded or failed (the hooks are stubbed).

const loaded = <T,>(data: T | null) => ({
  data,
  isLoading: false,
  isFetching: false,
  refetch: vi.fn(() => Promise.resolve()),
});
let worlds: ReturnType<typeof loaded>;
let quests: ReturnType<typeof loaded>;

vi.mock('@/hooks/useChildren', () => ({
  useChildren: () => ({
    isLoading: false,
    list: [{ id: 'c1', name: 'Aarav', age: 9, avatar_url: null, progress: { conversation: true } }],
  }),
}));
vi.mock('@/hooks/useKidActivity', () => ({
  useKidActivity: () => ({
    isLoading: false,
    isLoadingError: false,
    isFetching: false,
    refetch: vi.fn(),
    day: '2026-11-15',
    sending: false,
    send: vi.fn(),
    awaitProgress: vi.fn(),
    activity: {
      circles_done: { discover: true, grow: true, transform: true, release: true },
      discover_badge: true,
      flipped_powers: [],
      moods: {},
      shown: {},
    },
  }),
}));
vi.mock('@/hooks/useKidPowers', () => ({
  useKidPowers: () => ({ isLoading: false, powers: null }),
}));
vi.mock('@/hooks/useKidWorlds', () => ({
  useKidWorlds: () => ({ ...worlds, worlds: worlds.data }),
}));
vi.mock('@/hooks/useKidQuests', () => ({
  useKidQuests: () => ({ ...quests, quests: quests.data }),
}));
vi.mock('@/hooks/useStageSplash', () => ({ useStageSplash: () => [false, vi.fn()] }));
vi.mock('@/lib/AmbientAudioContext', () => ({
  useAmbientAudio: () => ({ setSuppressed: vi.fn() }),
}));
vi.mock('@/lib/TtsContext', () => ({ useTts: () => ({ ttsEnabled: false, toggleTts: vi.fn() }) }));
vi.mock('@/components/kids/KidsHeader', () => ({ default: () => null }));
vi.mock('@/components/kids/ConnectWins', () => ({
  default: ({ wins }: { wins: { title: string }[] }) => (
    <p data-testid="wins">{wins.map((w) => w.title).join(' | ')}</p>
  ),
}));

import KidsMode from '@/pages/KidsMode';

const WORLDS = {
  worlds: [{ name: 'Self Care' }],
  runs: { '0': [{ total: 50 }] },
  bands: [],
};
const QUESTS = {
  catalog: [{ key: 'art', quests: [{ title: 'Paint a cloud', target: 1 }] }],
  logs: { 'art:0': 1 },
};

function renderConnect() {
  render(
    <MemoryRouter initialEntries={['/Kids/c1/connect']}>
      <Routes>
        <Route path="/Kids/:childId/:area" element={<KidsMode />} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  worlds = loaded(WORLDS);
  quests = loaded(QUESTS);
});

describe('Connect in child view', () => {
  it('lists the wins from the quests, the worlds and the activity', () => {
    renderConnect();
    expect(screen.getByTestId('wins')).toHaveTextContent(
      'Quest done: Paint a cloud | Played the Self Care world | Discover badge unlocked',
    );
    expect(screen.queryByText("We couldn't load all your wins.")).not.toBeInTheDocument();
  });

  it("says so, with Try again, when the worlds didn't load, rather than a short list", async () => {
    worlds = loaded(null);
    const user = renderConnect();
    expect(screen.getByText("We couldn't load all your wins.")).toBeInTheDocument();
    expect(screen.queryByTestId('wins')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(worlds.refetch).toHaveBeenCalledTimes(1);
    expect(quests.refetch).not.toHaveBeenCalled();
  });

  it("does the same when the quests didn't load", async () => {
    quests = loaded(null);
    const user = renderConnect();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(quests.refetch).toHaveBeenCalledTimes(1);
    expect(worlds.refetch).not.toHaveBeenCalled();
  });
});
