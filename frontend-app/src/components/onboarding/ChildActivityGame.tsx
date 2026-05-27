import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Image } from 'react-native';
import { Button } from '@/components/ui/Button';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';
import { env } from '@/lib/env';

// Module-level cache of asset paths that have previously failed to load.
// Lives outside the component so it survives remounts and app-level rerenders.
const _failedAssetPaths = new Set<string>();

// Fallback gradient colours shown when an image fails to load.
const TILE_BG_COLORS = [
  'bg-purple-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
];

interface AreaGameOption {
  id: string;
  label: string;
  emoji: string;
  image: string;
}

interface AreaGame {
  question: string;
  subtitle: string;
  maxSelections: number;
  options: AreaGameOption[];
  promptContext: (labels: string[]) => string;
}

type AreaGamesMap = Record<string, AreaGame>;

const areaGames: AreaGamesMap = {
  life_ambition: {
    question: 'What do you want to become in life?',
    subtitle: 'Choose up to 3 options that excite you!',
    maxSelections: 3,
    options: [
      { id: 'astronaut', label: 'Astronaut', emoji: '🚀', image: 'child_activity_game/life_ambition/astronaut.jpg' },
      { id: 'sports', label: 'Sports Person', emoji: '⚽', image: 'child_activity_game/life_ambition/sports_person.jpg' },
      { id: 'parent', label: 'Like My Parents', emoji: '👨‍👩‍👧', image: 'child_activity_game/life_ambition/like_my_parents.jpg' },
      { id: 'superhero', label: 'Super Hero', emoji: '🦸', image: 'child_activity_game/life_ambition/super_hero.jpg' },
      { id: 'dancer', label: 'Dancer', emoji: '💃', image: 'child_activity_game/life_ambition/dancer.jpg' },
      { id: 'scientist', label: 'Scientist', emoji: '🔬', image: 'child_activity_game/life_ambition/scientist.jpg' },
    ],
    promptContext: (labels: string[]) =>
      `A child has selected these career aspirations: ${labels.join(', ')}. Generate personalized recommendations for the parent to help nurture these interests: 1. A brief summary of what these choices reveal about the child's interests, 2. 3-4 specific activities or experiences to support these aspirations, 3. 2-3 strengths to encourage based on these choices.`,
  },
  self_care: {
    question: 'Which activities make you feel calm and happy?',
    subtitle: 'Pick up to 3 things you enjoy!',
    maxSelections: 3,
    options: [
      { id: 'reading', label: 'Reading', emoji: '📚', image: 'child_activity_game/self_care/reading.jpg' },
      { id: 'music', label: 'Listening to Music', emoji: '🎵', image: 'child_activity_game/self_care/listening_to_music.jpg' },
      { id: 'nature', label: 'Being in Nature', emoji: '🌿', image: 'child_activity_game/self_care/being_in_nature.jpg' },
      { id: 'drawing', label: 'Drawing / Painting', emoji: '🎨', image: 'child_activity_game/self_care/drawing_painting.jpg' },
      { id: 'sleep', label: 'Resting / Sleeping', emoji: '😴', image: 'child_activity_game/self_care/resting_sleeping.jpg' },
      { id: 'exercise', label: 'Exercise', emoji: '🏃', image: 'child_activity_game/self_care/exercise.jpg' },
    ],
    promptContext: (labels: string[]) =>
      `A child has chosen these self-care activities as things that make them feel calm and happy: ${labels.join(', ')}. Generate personalized self-care recommendations for the parent: 1. A brief summary of what these choices reveal about the child's emotional needs, 2. 3-4 specific ways to support these self-care habits at home, 3. 2-3 emotional strengths to encourage.`,
  },
  critical_thinking: {
    question: 'Which challenges do you enjoy most?',
    subtitle: 'Choose up to 3 that sound fun!',
    maxSelections: 3,
    options: [
      { id: 'puzzles', label: 'Solving Puzzles', emoji: '🧩', image: 'child_activity_game/critical_thinking/solving_puzzles.jpg' },
      { id: 'experiments', label: 'Science Experiments', emoji: '🧪', image: 'child_activity_game/critical_thinking/science_experiments.jpg' },
      { id: 'debates', label: 'Debates & Arguments', emoji: '💬', image: 'child_activity_game/critical_thinking/debates_arguments.jpg' },
      { id: 'strategy', label: 'Strategy Games', emoji: '♟️', image: 'child_activity_game/critical_thinking/strategy_games.jpg' },
      { id: 'mysteries', label: 'Solving Mysteries', emoji: '🔍', image: 'child_activity_game/critical_thinking/solving_mysteries.jpg' },
      { id: 'inventions', label: 'Inventing Things', emoji: '💡', image: 'child_activity_game/critical_thinking/inventing_things.jpg' },
    ],
    promptContext: (labels: string[]) =>
      `A child has chosen these thinking challenges as their favourites: ${labels.join(', ')}. Generate personalized recommendations for the parent to develop their critical thinking: 1. A brief summary of what these choices reveal about the child's thinking style, 2. 3-4 specific activities to sharpen these skills, 3. 2-3 cognitive strengths to encourage.`,
  },
  creativity: {
    question: 'Which creative activities do you love?',
    subtitle: 'Pick up to 3 that spark your imagination!',
    maxSelections: 3,
    options: [
      { id: 'drawing', label: 'Drawing & Art', emoji: '🎨', image: 'child_activity_game/creativity/drawing_art.jpg' },
      { id: 'storytelling', label: 'Storytelling', emoji: '📖', image: 'child_activity_game/creativity/storytelling.jpg' },
      { id: 'music', label: 'Making Music', emoji: '🎸', image: 'child_activity_game/creativity/making_music.jpg' },
      { id: 'building', label: 'Building & Making', emoji: '🏗️', image: 'child_activity_game/creativity/building_making.jpg' },
      { id: 'acting', label: 'Acting & Drama', emoji: '🎭', image: 'child_activity_game/creativity/acting_drama.jpg' },
      { id: 'cooking', label: 'Cooking & Baking', emoji: '🍳', image: 'child_activity_game/creativity/cooking_baking.jpg' },
    ],
    promptContext: (labels: string[]) =>
      `A child has chosen these creative activities as their favourites: ${labels.join(', ')}. Generate personalized recommendations for the parent to nurture their creativity: 1. A brief summary of what these choices reveal about the child's creative personality, 2. 3-4 specific ways to encourage and develop these creative skills, 3. 2-3 creative strengths to celebrate.`,
  },
  physical_wellness: {
    question: 'Which physical activities do you enjoy?',
    subtitle: 'Choose up to 3 that get you moving!',
    maxSelections: 3,
    options: [
      { id: 'football', label: 'Football / Soccer', emoji: '⚽', image: 'child_activity_game/physical_wellness/football_soccer.jpg' },
      { id: 'swimming', label: 'Swimming', emoji: '🏊', image: 'child_activity_game/physical_wellness/swimming.jpg' },
      { id: 'cycling', label: 'Cycling', emoji: '🚴', image: 'child_activity_game/physical_wellness/cycling.jpg' },
      { id: 'dancing', label: 'Dancing', emoji: '💃', image: 'child_activity_game/physical_wellness/dancing.jpg' },
      { id: 'yoga', label: 'Yoga / Stretching', emoji: '🧘', image: 'child_activity_game/physical_wellness/yoga_stretching.jpg' },
      { id: 'running', label: 'Running', emoji: '🏃', image: 'child_activity_game/physical_wellness/running.jpg' },
    ],
    promptContext: (labels: string[]) =>
      `A child has chosen these physical activities as their favourites: ${labels.join(', ')}. Generate personalized physical wellness recommendations for the parent: 1. A brief summary of what these choices reveal about the child's physical personality, 2. 3-4 specific ways to support and grow these physical habits, 3. 2-3 physical strengths to encourage.`,
  },
  social_skills: {
    question: 'Which situations feel most natural to you?',
    subtitle: 'Choose up to 3 that sound like you!',
    maxSelections: 3,
    options: [
      { id: 'helping', label: 'Helping Others', emoji: '🤝', image: 'child_activity_game/social_skills/helping_others.jpg' },
      { id: 'leading', label: 'Leading a Group', emoji: '👑', image: 'child_activity_game/social_skills/leading_a_group.jpg' },
      { id: 'listening', label: 'Listening to Friends', emoji: '👂', image: 'child_activity_game/social_skills/listening_to_friends.jpg' },
      { id: 'teamwork', label: 'Working in a Team', emoji: '🙌', image: 'child_activity_game/social_skills/working_in_a_team.jpg' },
      { id: 'making_friends', label: 'Making New Friends', emoji: '😊', image: 'child_activity_game/social_skills/making_new_friends.jpg' },
      { id: 'alone', label: 'Enjoying My Own Time', emoji: '🧸', image: 'child_activity_game/social_skills/enjoying_my_own_time.jpg' },
    ],
    promptContext: (labels: string[]) =>
      `A child has identified these social situations as most natural to them: ${labels.join(', ')}. Generate personalized social skills recommendations for the parent: 1. A brief summary of what these choices reveal about the child's social personality, 2. 3-4 specific activities to strengthen their social skills, 3. 2-3 social strengths to celebrate.`,
  },
};

/** Canonical child-game LLM blob: `suggested_activities` only; strip `activities` if echoed. */
// eslint-disable-next-line react-refresh/only-export-components
export function normalizeChildGameRecommendations(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return raw as Record<string, unknown>;
  const rawObj = raw as Record<string, unknown>;
  const suggested = Array.isArray(rawObj.suggested_activities)
    ? [...(rawObj.suggested_activities as unknown[])]
    : [];
  const { activities: _a, suggested_activities: _s, ...rest } = rawObj;
  return { ...rest, suggested_activities: suggested };
}

interface ChildActivityGameProps {
  childName?: string;
  areaId?: string;
  activeChildId?: string;
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  onComplete: (result: {
    selections: string[];
    recommendations: Record<string, unknown>;
  }) => void | Promise<void>;
}

export default function ChildActivityGame({
  childName,
  areaId = 'life_ambition',
  activeChildId,
  selectedIds = [],
  onSelectedIdsChange,
  onComplete,
}: ChildActivityGameProps) {
  const game = areaGames[areaId] ?? areaGames['life_ambition']!;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(
    () => new Set(game.options.filter((o) => _failedAssetPaths.has(o.image)).map((o) => o.id)),
  );

  // When areaId changes (component stays mounted), re-seed failedImages from the cache.
  useEffect(() => {
    setFailedImages(
      new Set(game.options.filter((o) => _failedAssetPaths.has(o.image)).map((o) => o.id)),
    );
    // game is derived from areaId; only re-run when the area actually changes.
  }, [areaId, game.options]);

  const ids = useMemo(() => (Array.isArray(selectedIds) ? selectedIds : []), [selectedIds]);

  const toggleSelection = useCallback(
    (id: string) => {
      const notify = onSelectedIdsChange ?? (() => {});
      if (ids.includes(id)) {
        notify(ids.filter((s) => s !== id));
      } else if (ids.length < game.maxSelections) {
        notify([...ids, id]);
      } else {
        toast.error(`You can select maximum ${game.maxSelections} options`);
      }
    },
    [ids, game.maxSelections, onSelectedIdsChange],
  );

  const handleSubmit = async () => {
    if (ids.length === 0) {
      toast.error('Please select at least 1 option');
      return;
    }

    setIsSubmitting(true);

    try {
      // Check DB first — skip LLM if results already saved for this area
      const completedData = (await api.completedGrowthAreas.list(activeChildId ?? '')) as Record<
        string,
        unknown
      >;
      const areasArr = Array.isArray((completedData as { areas?: unknown }).areas)
        ? (completedData as { areas: Array<Record<string, unknown>> }).areas
        : [];
      const existing = areasArr.find((a) => a.area_id === areaId);
      const existingChildActivity = existing?.child_activity as Record<string, unknown> | undefined;
      if (existingChildActivity?.results) {
        const recommendations = normalizeChildGameRecommendations(existingChildActivity.results);
        const existingSelections = Array.isArray(existingChildActivity.selections)
          ? (existingChildActivity.selections as string[])
          : ids;
        const done = onComplete({
          selections: existingSelections,
          recommendations,
        });
        if (done != null && typeof done.then === 'function') await done;
        setIsSubmitting(false);
        return;
      }
    } catch (err) {
      console.warn('[ChildActivityGame] Cached result fetch failed, falling through to LLM:', err);
    }

    const selectedLabels = ids.map((id) => game.options.find((o) => o.id === id)?.label ?? id);

    try {
      const raw = await api.integrations.Core.InvokeLLM({
        prompt: `A child named ${childName} has made the following selections.\n\n${game.promptContext(selectedLabels)}`,
        response_json_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            suggested_activities: { type: 'array', items: { type: 'string' } },
            strengths: { type: 'array', items: { type: 'string' } },
          },
        },
      });

      const recommendations = normalizeChildGameRecommendations(raw);
      const done = onComplete({ selections: ids, recommendations });
      if (done != null && typeof done.then === 'function') await done;
    } catch (err) {
      console.error('[ChildActivityGame] Recommendation generation failed:', err);
      toast.error('Could not generate recommendations. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-6">
      <View className="space-y-6">
        <View className="items-center">
          <Text className="mb-2 text-center text-2xl font-bold text-white">{game.question}</Text>
          <Text className="text-center text-slate-500">{game.subtitle}</Text>
          <Text className="mt-2 text-sm text-emerald-600">
            Selected: {ids.length}/{game.maxSelections}
          </Text>
        </View>

        {/* Tap-to-select grid (replaces drag-drop) */}
        <View className="flex-row flex-wrap gap-4 justify-between">
          {game.options.map((option, index) => {
            const isSelected = ids.includes(option.id);
            const hasFailed = failedImages.has(option.id);
            return (
              <Pressable
                key={option.id}
                onPress={() => toggleSelection(option.id)}
                className={`overflow-hidden rounded-2xl border-4 ${isSelected ? 'border-emerald-500' : 'border-white/10'}`}
                style={{ width: '47%' }}
                android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
              >
                {/* Image or fallback emoji tile */}
                {!hasFailed ? (
                  <Image
                    source={{ uri: `${env.CDN_BASE_URL}/app-assets/${option.image}` }}
                    className="w-full"
                    style={{ aspectRatio: 4 / 3 }}
                    resizeMode="cover"
                    onError={() => {
                      _failedAssetPaths.add(option.image);
                      setFailedImages((prev) => new Set([...prev, option.id]));
                    }}
                  />
                ) : (
                  <View
                    className={`w-full items-center justify-center ${TILE_BG_COLORS[index % TILE_BG_COLORS.length]}`}
                    style={{ aspectRatio: 4 / 3 }}
                  >
                    <Text style={{ fontSize: 48 }}>{option.emoji}</Text>
                  </View>
                )}

                {/* Label overlay */}
                <View className="absolute inset-0 flex-col justify-end p-3 bg-gradient-to-t from-black/60 to-transparent">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-semibold text-white flex-1 mr-1">{option.label}</Text>
                    <Text className="text-lg">{isSelected ? '✅' : '⭕'}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Button
          onPress={() => { void handleSubmit(); }}
          disabled={ids.length === 0 || isSubmitting}
          className="h-12 w-full rounded-2xl bg-emerald-500 items-center justify-center"
        >
          <Text className="font-semibold text-white">
            {isSubmitting ? 'Generating Recommendations...' : 'Submit My Choices'}
          </Text>
        </Button>
      </View>
    </ScrollView>
  );
}
