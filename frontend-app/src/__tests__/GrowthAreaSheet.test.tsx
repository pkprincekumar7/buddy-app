import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import GrowthAreaSheet, {
  type RecsPhase,
} from '@/components/growth/GrowthAreaSheet';
import { PortalHost } from '@/components/ui/portal';
import { daysAgo, worldSummary, type KidWorlds } from '@/api/kidWorlds';
import { GROWTH_AREAS, type Question } from '@/lib/growthAreaData';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const AREA = GROWTH_AREAS[0]!;

const game = (title: string, skill: string) => ({
  type: 'sort' as const,
  title,
  skill,
  how: '',
  tip: '',
  cfg: {},
});
const worlds = (runs: KidWorlds['runs']): KidWorlds =>
  ({
    worlds: [
      {
        name: AREA.name,
        icon: '',
        mission: '',
        hint: '',
        games: [
          game('One', 'Habits'),
          game('Two', 'Choices'),
          game('Three', 'Calm'),
        ],
      },
    ],
    bands: [
      { min: 80, label: 'Super strong', color: 'gold' },
      { min: 55, label: 'Growing well', color: 'cyan' },
      { min: 0, label: 'Keep practising', color: 'violet' },
    ],
    runs,
  } as unknown as KidWorlds);
const run = (total: number, scores: number[], at: string) => ({
  total,
  scores,
  at,
});

const QUESTIONS: Question[] = [1, 2, 3, 4, 5].map(n => ({
  id: `q${n}`,
  question: `Question ${n} about {name}?`,
  hint: `Hint ${n}`,
}));

function setup(
  props: Partial<React.ComponentProps<typeof GrowthAreaSheet>> & {
    recsPhase?: RecsPhase;
  } = {},
) {
  const handlers = {
    onClose: jest.fn(),
    onSaveAnswers: jest.fn(async () => true),
    onShowInsights: jest.fn(),
    onExploreTransform: jest.fn(),
    onRetryRecommendations: jest.fn(),
  };
  const view = render(
    <PortalHost>
      <GrowthAreaSheet
        area={AREA}
        childName="Aarav"
        childGender="male"
        parentQuestions={{
          data: QUESTIONS,
          status: 'ready',
          onRetry: jest.fn(),
        }}
        answered={0}
        world={null}
        {...handlers}
        {...props}
      />
    </PortalHost>,
  );
  return { ...view, ...handlers };
}

describe('GrowthAreaSheet', () => {
  it('walks the five reflections, saves on Finish and moves to the insights', async () => {
    const { getByText, getByLabelText, onSaveAnswers } = setup();
    expect(getByText('Guided Reflection')).toBeTruthy();
    expect(getByText('Question 1 about Aarav?')).toBeTruthy();
    fireEvent.changeText(getByLabelText('Question 1 about Aarav?'), 'Often');
    for (let i = 0; i < 4; i++) fireEvent.press(getByLabelText('Next'));
    await act(async () => {
      fireEvent.press(getByLabelText('Finish'));
    });
    expect(onSaveAnswers).toHaveBeenCalledWith({ q1: 'Often' });
    expect(getByText('Growth insights')).toBeTruthy();
  });

  it('says there is nothing to go on without answers or games', () => {
    const { getByText, queryByText } = setup({ initialPhase: 'insights' });
    expect(getByText('No reflections yet')).toBeTruthy();
    expect(getByText('Games not played yet')).toBeTruthy();
    expect(getByText('Nothing to go on yet')).toBeTruthy();
    expect(queryByText('Recommendations', { exact: true })).toBeTruthy(); // the tab only
    expect(queryByText('From your answers')).toBeNull();
  });

  it('shows the latest run and tagged recommendations', () => {
    const at = new Date().toISOString();
    const w = worlds({
      '0': [
        run(60, [60, 60, 60], '2026-11-01T10:00:00Z'),
        run(70, [90, 50, 70], at),
      ],
    });
    const { getByText, getAllByText } = setup({
      initialPhase: 'insights',
      answered: 5,
      world: worldSummary(w, AREA.name),
      recsPhase: 'ready',
      recommendations: [
        { title: 'Together', detail: 'd1', source: 'both' },
        { title: 'Games', detail: 'd2', source: 'kid' },
        { title: 'Answers', detail: 'd3', source: 'you' },
        { title: 'Next', detail: 'd4', source: 'step' },
      ],
    });
    expect(getByText('5 of 5 reflections answered')).toBeTruthy();
    expect(getByText('2 game rounds, last today')).toBeTruthy();
    expect(getByText('Latest child view result')).toBeTruthy();
    expect(getByText('Strongest: Habits. Room to grow: Choices.')).toBeTruthy();
    expect(getByText('Played today · 2 tries · +10 vs last try')).toBeTruthy();
    expect(getAllByText('70').length).toBeGreaterThan(0);
    expect(getByText('From your answers and Aarav’s games')).toBeTruthy();
    expect(getByText('You + Aarav')).toBeTruthy();
    expect(getByText('Aarav’s games')).toBeTruthy();
    expect(getByText('Your answers')).toBeTruthy();
    expect(getByText('Next step')).toBeTruthy();
  });

  it('offers a retry when the recommendations fail, and leaves for Transform', () => {
    const {
      getByLabelText,
      getByText,
      onRetryRecommendations,
      onExploreTransform,
    } = setup({ initialPhase: 'insights', answered: 2, recsPhase: 'error' });
    expect(getByText('Aarav’s side is missing')).toBeTruthy();
    expect(getByText('From your answers')).toBeTruthy();
    fireEvent.press(getByLabelText('Try again'));
    expect(onRetryRecommendations).toHaveBeenCalledTimes(1);
    fireEvent.press(getByLabelText('Explore Transform'));
    expect(onExploreTransform).toHaveBeenCalledTimes(1);
  });

  it('asks the caller for current recommendations from the tab', () => {
    const { getByLabelText, getByText, onShowInsights } = setup();
    fireEvent.press(getByLabelText('Recommendations'));
    expect(onShowInsights).toHaveBeenCalledTimes(1);
    expect(getByText('Growth insights')).toBeTruthy();
    fireEvent.press(getByLabelText('Reflection'));
    expect(getByText('Guided Reflection')).toBeTruthy();
  });
});

describe('daysAgo', () => {
  it('counts calendar days', () => {
    const now = new Date(2026, 10, 11, 9);
    expect(daysAgo(new Date(2026, 10, 11, 1).toISOString(), now)).toBe('today');
    expect(daysAgo(new Date(2026, 10, 10, 23).toISOString(), now)).toBe(
      'yesterday',
    );
    expect(daysAgo(new Date(2026, 10, 8, 12).toISOString(), now)).toBe(
      '3 days ago',
    );
  });
});
