import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

// Connect in child view builds its wins from the activity, the quests and the worlds; these
// tests drive the page with each source loaded or failed.

type Loaded<K extends string> = { [key in K]: unknown } & {
  isLoading: boolean;
  isFetching: boolean;
  refetch: jest.Mock;
};
let mockWorlds: Loaded<'worlds'>;
let mockQuests: Loaded<'quests'>;

jest.mock('@/lib/router', () => ({
  Navigate: () => null,
  navigationRef: {},
  useNavigate: () => jest.fn(),
  useParams: () => ({ childId: 'c1', sub: 'connect' }),
}));
jest.mock('@/hooks/useChildren', () => ({
  useChildren: () => ({
    isLoading: false,
    list: [
      {
        id: 'c1',
        name: 'Aarav',
        age: 9,
        avatar_url: null,
        progress: { conversation: true },
      },
    ],
  }),
}));
jest.mock('@/hooks/useKidActivity', () => ({
  useKidActivity: () => ({
    isLoading: false,
    isLoadingError: false,
    isFetching: false,
    refetch: jest.fn(),
    day: '2026-11-15',
    sending: false,
    send: jest.fn(),
    awaitProgress: jest.fn(),
    activity: {
      circles_done: {
        discover: true,
        grow: true,
        transform: true,
        release: true,
      },
      discover_badge: true,
      flipped_powers: [],
      moods: {},
      shown: {},
    },
  }),
}));
jest.mock('@/hooks/useKidPowers', () => ({
  useKidPowers: () => ({ isLoading: false, powers: null }),
}));
jest.mock('@/hooks/useKidWorlds', () => ({ useKidWorlds: () => mockWorlds }));
jest.mock('@/hooks/useKidQuests', () => ({ useKidQuests: () => mockQuests }));
jest.mock('@/hooks/useStageSplash', () => ({
  useStageSplash: () => [false, jest.fn()],
}));
jest.mock('@/lib/AmbientAudioContext', () => ({
  useAmbientAudio: () => ({ setSuppressed: jest.fn() }),
}));
jest.mock('@/lib/TtsContext', () => ({
  useTts: () => ({ ttsEnabled: false, toggleTts: jest.fn() }),
}));
jest.mock('@/lib/tts', () => ({ speakText: jest.fn(), stopSpeech: jest.fn() }));
jest.mock('@/components/layout/PageScroll', () => {
  const { View: V } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return ({ children }: { children: React.ReactNode }) => <V>{children}</V>;
});
jest.mock('@/components/kids/KidsHeader', () => () => null);
jest.mock('@/components/shared/StageSplash', () => () => null);
jest.mock('@/components/kids/ConnectWins', () => {
  const { Text: T } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return ({ wins }: { wins: { title: string }[] }) => (
    <T>{wins.map(w => w.title).join(' | ')}</T>
  );
});

import KidsMode from '@/screens/KidsMode';

const WORLDS = {
  worlds: [{ name: 'Self Care' }],
  runs: { '0': [{ total: 50 }] },
  bands: [],
};
const QUESTS = {
  catalog: [{ key: 'art', quests: [{ title: 'Paint a cloud', target: 1 }] }],
  logs: { 'art:0': 1 },
};
const loaded = <K extends 'worlds' | 'quests'>(key: K, data: unknown) =>
  ({
    [key]: data,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
  } as Loaded<K>);

beforeEach(() => {
  mockWorlds = loaded('worlds', WORLDS);
  mockQuests = loaded('quests', QUESTS);
});

describe('Connect in child view', () => {
  it('lists the wins from the quests, the worlds and the activity', () => {
    const { getByText, queryByText } = render(<KidsMode />);
    expect(
      getByText(
        'Quest done: Paint a cloud | Played the Self Care world | Discover badge unlocked',
      ),
    ).toBeTruthy();
    expect(queryByText('We couldn’t load all your wins.')).toBeNull();
  });

  it("says so, with Try again, when the worlds didn't load, rather than a short list", () => {
    mockWorlds = loaded('worlds', null);
    const { getByText, getByLabelText, queryByText } = render(<KidsMode />);
    expect(getByText('We couldn’t load all your wins.')).toBeTruthy();
    expect(queryByText(/Quest done/)).toBeNull();
    fireEvent.press(getByLabelText('Try again'));
    expect(mockWorlds.refetch).toHaveBeenCalledTimes(1);
    expect(mockQuests.refetch).not.toHaveBeenCalled();
  });

  it("does the same when the quests didn't load", () => {
    mockQuests = loaded('quests', null);
    const { getByText, getByLabelText } = render(<KidsMode />);
    expect(getByText('We couldn’t load all your wins.')).toBeTruthy();
    fireEvent.press(getByLabelText('Try again'));
    expect(mockQuests.refetch).toHaveBeenCalledTimes(1);
    expect(mockWorlds.refetch).not.toHaveBeenCalled();
  });
});
