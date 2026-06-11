import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Image } from 'react-native';
import { CheckCircle, Circle } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';
import { env } from '@/lib/env';
import { useTheme } from '@/lib/ThemeContext';
import { TILE_BG_HEX_COLORS } from '@/lib/gradientColors';

// Module-level cache of asset paths that have previously failed to load.
// Lives outside the component so it survives remounts and app-level rerenders.
const _failedAssetPaths = new Set<string>();

function themedImagePath(path: string, isDark: boolean): string {
  return path.replace(/\.jpg$/, isDark ? '_vg_dark.png' : '_vg_light.png');
}

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
  promptContext: (
    labels: string[],
    childAge?: string | number | null,
    childGender?: string | null,
    childName?: string | null,
  ) => string;
}

type AreaGamesMap = Record<string, AreaGame>;

const areaGames: AreaGamesMap = {
  life_ambition: {
    question: 'What do you want to become in life?',
    subtitle: 'Choose up to 3 options that excite you!',
    maxSelections: 3,
    options: [
      {
        id: 'astronaut',
        label: 'Astronaut',
        emoji: '🚀',
        image: 'child_activity_game/life_ambition/astronaut.jpg',
      },
      {
        id: 'sports',
        label: 'Sports Person',
        emoji: '⚽',
        image: 'child_activity_game/life_ambition/sports_person.jpg',
      },
      {
        id: 'parent',
        label: 'Like My Parents',
        emoji: '👨‍👩‍👧',
        image: 'child_activity_game/life_ambition/like_my_parents.jpg',
      },
      {
        id: 'superhero',
        label: 'Super Hero',
        emoji: '🦸',
        image: 'child_activity_game/life_ambition/super_hero.jpg',
      },
      {
        id: 'dancer',
        label: 'Dancer',
        emoji: '💃',
        image: 'child_activity_game/life_ambition/dancer.jpg',
      },
      {
        id: 'scientist',
        label: 'Scientist',
        emoji: '🔬',
        image: 'child_activity_game/life_ambition/scientist.jpg',
      },
    ],
    promptContext: (labels: string[], childAge?, childGender?, childName?) =>
      `${childName ?? 'A child'} (${childAge ?? 'school-age'}-year-old ${
        childGender ?? 'child'
      }) has selected these career aspirations: ${labels.join(
        ', ',
      )}. These selections will be used to generate a personalised development plan for the parent.\n\nReturn ONLY a valid JSON object with exactly these three fields (use these exact key names):\n- "summary": one sentence describing what these career choices reveal about this child's interests and motivations, taking into account their age and gender.\n- "suggested_activities": an array of 3–4 concrete, age-appropriate activities or experiences the parent can provide to nurture these aspirations. IMPORTANT: the key must be "suggested_activities" exactly.\n- "strengths": an array of 2–3 specific strengths these choices suggest the child has or is developing.`,
  },
  self_care: {
    question: 'Which activities make you feel calm and happy?',
    subtitle: 'Pick up to 3 things you enjoy!',
    maxSelections: 3,
    options: [
      {
        id: 'reading',
        label: 'Reading',
        emoji: '📚',
        image: 'child_activity_game/self_care/reading.jpg',
      },
      {
        id: 'music',
        label: 'Listening to Music',
        emoji: '🎵',
        image: 'child_activity_game/self_care/listening_to_music.jpg',
      },
      {
        id: 'nature',
        label: 'Being in Nature',
        emoji: '🌿',
        image: 'child_activity_game/self_care/being_in_nature.jpg',
      },
      {
        id: 'drawing',
        label: 'Drawing / Painting',
        emoji: '🎨',
        image: 'child_activity_game/self_care/drawing_painting.jpg',
      },
      {
        id: 'sleep',
        label: 'Resting / Sleeping',
        emoji: '😴',
        image: 'child_activity_game/self_care/resting_sleeping.jpg',
      },
      {
        id: 'exercise',
        label: 'Exercise',
        emoji: '🏃',
        image: 'child_activity_game/self_care/exercise.jpg',
      },
    ],
    promptContext: (labels: string[], childAge?, childGender?, childName?) =>
      `${childName ?? 'A child'} (${childAge ?? 'school-age'}-year-old ${
        childGender ?? 'child'
      }) has chosen these activities as things that make them feel calm and happy: ${labels.join(
        ', ',
      )}. These selections will be used to generate a personalised self-care development plan for the parent.\n\nReturn ONLY a valid JSON object with exactly these three fields (use these exact key names):\n- "summary": one sentence describing what these self-care choices reveal about this child's emotional needs and coping style, considering their age and gender.\n- "suggested_activities": an array of 3–4 specific, age-appropriate ways the parent can support and strengthen these self-care habits at home. IMPORTANT: the key must be "suggested_activities" exactly.\n- "strengths": an array of 2–3 emotional or wellbeing strengths these choices suggest the child has or is developing.`,
  },
  critical_thinking: {
    question: 'Which challenges do you enjoy most?',
    subtitle: 'Choose up to 3 that sound fun!',
    maxSelections: 3,
    options: [
      {
        id: 'puzzles',
        label: 'Solving Puzzles',
        emoji: '🧩',
        image: 'child_activity_game/critical_thinking/solving_puzzles.jpg',
      },
      {
        id: 'experiments',
        label: 'Science Experiments',
        emoji: '🧪',
        image: 'child_activity_game/critical_thinking/science_experiments.jpg',
      },
      {
        id: 'debates',
        label: 'Debates & Arguments',
        emoji: '💬',
        image: 'child_activity_game/critical_thinking/debates_arguments.jpg',
      },
      {
        id: 'strategy',
        label: 'Strategy Games',
        emoji: '♟️',
        image: 'child_activity_game/critical_thinking/strategy_games.jpg',
      },
      {
        id: 'mysteries',
        label: 'Solving Mysteries',
        emoji: '🔍',
        image: 'child_activity_game/critical_thinking/solving_mysteries.jpg',
      },
      {
        id: 'inventions',
        label: 'Inventing Things',
        emoji: '💡',
        image: 'child_activity_game/critical_thinking/inventing_things.jpg',
      },
    ],
    promptContext: (labels: string[], childAge?, childGender?, childName?) =>
      `${childName ?? 'A child'} (${childAge ?? 'school-age'}-year-old ${
        childGender ?? 'child'
      }) has chosen these thinking challenges as their favourites: ${labels.join(
        ', ',
      )}. These selections will be used to generate a personalised critical thinking development plan for the parent.\n\nReturn ONLY a valid JSON object with exactly these three fields (use these exact key names):\n- "summary": one sentence describing what these choices reveal about this child's thinking style and cognitive preferences, considering their age and gender.\n- "suggested_activities": an array of 3–4 specific, age-appropriate activities to sharpen these critical thinking skills. IMPORTANT: the key must be "suggested_activities" exactly.\n- "strengths": an array of 2–3 cognitive strengths these choices suggest the child has or is developing.`,
  },
  creativity: {
    question: 'Which creative activities do you love?',
    subtitle: 'Pick up to 3 that spark your imagination!',
    maxSelections: 3,
    options: [
      {
        id: 'drawing',
        label: 'Drawing & Art',
        emoji: '🎨',
        image: 'child_activity_game/creativity/drawing_art.jpg',
      },
      {
        id: 'storytelling',
        label: 'Storytelling',
        emoji: '📖',
        image: 'child_activity_game/creativity/storytelling.jpg',
      },
      {
        id: 'music',
        label: 'Making Music',
        emoji: '🎸',
        image: 'child_activity_game/creativity/making_music.jpg',
      },
      {
        id: 'building',
        label: 'Building & Making',
        emoji: '🏗️',
        image: 'child_activity_game/creativity/building_making.jpg',
      },
      {
        id: 'acting',
        label: 'Acting & Drama',
        emoji: '🎭',
        image: 'child_activity_game/creativity/acting_drama.jpg',
      },
      {
        id: 'cooking',
        label: 'Cooking & Baking',
        emoji: '🍳',
        image: 'child_activity_game/creativity/cooking_baking.jpg',
      },
    ],
    promptContext: (labels: string[], childAge?, childGender?, childName?) =>
      `${childName ?? 'A child'} (${childAge ?? 'school-age'}-year-old ${
        childGender ?? 'child'
      }) has chosen these creative activities as their favourites: ${labels.join(
        ', ',
      )}. These selections will be used to generate a personalised creativity development plan for the parent.\n\nReturn ONLY a valid JSON object with exactly these three fields (use these exact key names):\n- "summary": one sentence describing what these creative choices reveal about this child's expressive personality and creative instincts, considering their age and gender.\n- "suggested_activities": an array of 3–4 specific, age-appropriate ways the parent can encourage and develop these creative skills. IMPORTANT: the key must be "suggested_activities" exactly.\n- "strengths": an array of 2–3 creative strengths these choices suggest the child has or is developing.`,
  },
  physical_wellness: {
    question: 'Which physical activities do you enjoy?',
    subtitle: 'Choose up to 3 that get you moving!',
    maxSelections: 3,
    options: [
      {
        id: 'football',
        label: 'Football / Soccer',
        emoji: '⚽',
        image: 'child_activity_game/physical_wellness/football_soccer.jpg',
      },
      {
        id: 'swimming',
        label: 'Swimming',
        emoji: '🏊',
        image: 'child_activity_game/physical_wellness/swimming.jpg',
      },
      {
        id: 'cycling',
        label: 'Cycling',
        emoji: '🚴',
        image: 'child_activity_game/physical_wellness/cycling.jpg',
      },
      {
        id: 'dancing',
        label: 'Dancing',
        emoji: '💃',
        image: 'child_activity_game/physical_wellness/dancing.jpg',
      },
      {
        id: 'yoga',
        label: 'Yoga / Stretching',
        emoji: '🧘',
        image: 'child_activity_game/physical_wellness/yoga_stretching.jpg',
      },
      {
        id: 'running',
        label: 'Running',
        emoji: '🏃',
        image: 'child_activity_game/physical_wellness/running.jpg',
      },
    ],
    promptContext: (labels: string[], childAge?, childGender?, childName?) =>
      `${childName ?? 'A child'} (${childAge ?? 'school-age'}-year-old ${
        childGender ?? 'child'
      }) has chosen these physical activities as their favourites: ${labels.join(
        ', ',
      )}. These selections will be used to generate a personalised physical wellness plan for the parent.\n\nReturn ONLY a valid JSON object with exactly these three fields (use these exact key names):\n- "summary": one sentence describing what these physical choices reveal about this child's energy, movement preferences, and physical personality, considering their age and gender.\n- "suggested_activities": an array of 3–4 specific, age-appropriate ways the parent can support and grow these physical habits. IMPORTANT: the key must be "suggested_activities" exactly.\n- "strengths": an array of 2–3 physical strengths these choices suggest the child has or is developing.`,
  },
  social_skills: {
    question: 'Which situations feel most natural to you?',
    subtitle: 'Choose up to 3 that sound like you!',
    maxSelections: 3,
    options: [
      {
        id: 'helping',
        label: 'Helping Others',
        emoji: '🤝',
        image: 'child_activity_game/social_skills/helping_others.jpg',
      },
      {
        id: 'leading',
        label: 'Leading a Group',
        emoji: '👑',
        image: 'child_activity_game/social_skills/leading_a_group.jpg',
      },
      {
        id: 'listening',
        label: 'Listening to Friends',
        emoji: '👂',
        image: 'child_activity_game/social_skills/listening_to_friends.jpg',
      },
      {
        id: 'teamwork',
        label: 'Working in a Team',
        emoji: '🙌',
        image: 'child_activity_game/social_skills/working_in_a_team.jpg',
      },
      {
        id: 'making_friends',
        label: 'Making New Friends',
        emoji: '😊',
        image: 'child_activity_game/social_skills/making_new_friends.jpg',
      },
      {
        id: 'alone',
        label: 'Enjoying My Own Time',
        emoji: '🧸',
        image: 'child_activity_game/social_skills/enjoying_my_own_time.jpg',
      },
    ],
    promptContext: (labels: string[], childAge?, childGender?, childName?) =>
      `${childName ?? 'A child'} (${childAge ?? 'school-age'}-year-old ${
        childGender ?? 'child'
      }) has identified these social situations as most natural to them: ${labels.join(
        ', ',
      )}. These selections will be used to generate a personalised social skills development plan for the parent.\n\nReturn ONLY a valid JSON object with exactly these three fields (use these exact key names):\n- "summary": one sentence describing what these choices reveal about this child's social personality and interpersonal style, considering their age and gender.\n- "suggested_activities": an array of 3–4 specific, age-appropriate activities to strengthen their social skills. IMPORTANT: the key must be "suggested_activities" exactly.\n- "strengths": an array of 2–3 social strengths these choices suggest the child has or is developing.`,
  },
};

/** Canonical child-game LLM blob: `suggested_activities` only; strip `activities` if echoed. */
export function normalizeChildGameRecommendations(
  raw: unknown,
): Record<string, unknown> {
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
  childAge?: string | number | null;
  childGender?: string | null;
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
  childAge,
  childGender,
  areaId = 'life_ambition',
  activeChildId,
  selectedIds = [],
  onSelectedIdsChange,
  onComplete,
}: ChildActivityGameProps) {
  const { colors, isDark } = useTheme();
  const game = areaGames[areaId] ?? areaGames.life_ambition!;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(
    () =>
      new Set(
        game.options.filter(o => _failedAssetPaths.has(o.image)).map(o => o.id),
      ),
  );

  // When areaId changes (component stays mounted), re-seed failedImages from the cache.
  useEffect(() => {
    setFailedImages(
      new Set(
        game.options.filter(o => _failedAssetPaths.has(o.image)).map(o => o.id),
      ),
    );
    // game is derived from areaId; only re-run when the area actually changes.
  }, [areaId, game.options]);

  const ids = useMemo(
    () => (Array.isArray(selectedIds) ? selectedIds : []),
    [selectedIds],
  );

  const toggleSelection = useCallback(
    (id: string) => {
      const notify = onSelectedIdsChange ?? (() => {});
      if (ids.includes(id)) {
        notify(ids.filter(s => s !== id));
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
      const completedData = (await api.completedGrowthAreas.list(
        activeChildId ?? '',
      )) as Record<string, unknown>;
      const areasArr = Array.isArray(
        (completedData as { areas?: unknown }).areas,
      )
        ? (completedData as { areas: Array<Record<string, unknown>> }).areas
        : [];
      const existing = areasArr.find(a => a.area_id === areaId);
      const existingChildActivity = existing?.child_activity as
        | Record<string, unknown>
        | undefined;
      if (existingChildActivity?.results) {
        const recommendations = normalizeChildGameRecommendations(
          existingChildActivity.results,
        );
        const existingSelections = Array.isArray(
          existingChildActivity.selections,
        )
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
      console.warn(
        '[ChildActivityGame] Cached result fetch failed, falling through to LLM:',
        err,
      );
    }

    const selectedLabels = ids.map(
      id => game.options.find(o => o.id === id)?.label ?? id,
    );

    try {
      const raw = await api.integrations.Core.InvokeLLM({
        prompt: game.promptContext(
          selectedLabels,
          childAge,
          childGender,
          childName,
        ),
        response_json_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            suggested_activities: {
              type: 'array',
              items: { type: 'string' },
              minItems: 3,
              maxItems: 4,
            },
            strengths: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 3,
            },
          },
        },
      });

      const recommendations = normalizeChildGameRecommendations(raw);
      const done = onComplete({ selections: ids, recommendations });
      if (done != null && typeof done.then === 'function') await done;
    } catch (err) {
      console.error(
        '[ChildActivityGame] Recommendation generation failed:',
        err,
      );
      toast.error('Could not generate recommendations. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-6">
      <View className="space-y-6">
        <View className="items-center">
          <Text
            className="mb-2 text-center text-2xl font-bold"
            style={{ color: colors.text }}
          >
            {game.question}
          </Text>
          <Text className="text-center" style={{ color: colors.iconColor }}>
            {game.subtitle}
          </Text>
          <Text className="mt-2 text-sm" style={{ color: colors.success }}>
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
                className="overflow-hidden rounded-2xl border-4"
                style={{
                  width: '47%',
                  borderColor: isSelected ? colors.success : colors.border,
                }}
                android_ripple={{ color: colors.ripple }}
              >
                {/* Image or fallback emoji tile */}
                {!hasFailed ? (
                  <Image
                    source={{
                      uri: `${env.CDN_BASE_URL}/app-assets/${themedImagePath(
                        option.image,
                        isDark,
                      )}`,
                    }}
                    className="w-full"
                    style={{ aspectRatio: 4 / 3 }}
                    resizeMode="cover"
                    onError={() => {
                      _failedAssetPaths.add(option.image);
                      setFailedImages(prev => new Set([...prev, option.id]));
                    }}
                  />
                ) : (
                  <View
                    className="w-full items-center justify-center"
                    style={{
                      aspectRatio: 4 / 3,
                      backgroundColor:
                        TILE_BG_HEX_COLORS[index % TILE_BG_HEX_COLORS.length],
                    }}
                  >
                    <Text style={{ fontSize: 48 }}>{option.emoji}</Text>
                  </View>
                )}

                {/* Label bar — bottom only, preserves image visibility */}
                <View
                  className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-3 py-2"
                  style={{ backgroundColor: colors.imageScrimColor }}
                >
                  <Text
                    className="text-sm font-semibold flex-1 mr-1"
                    style={{ color: '#ffffff' }}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  {isSelected ? (
                    <CheckCircle
                      size={22}
                      color={colors.primaryForeground}
                      fill={colors.success}
                    />
                  ) : (
                    <Circle size={22} color="rgba(255,255,255,0.7)" />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Button
          size="xl"
          onPress={() => {
            void handleSubmit();
          }}
          disabled={ids.length === 0 || isSubmitting}
          className="w-full rounded-2xl items-center justify-center"
          style={{ backgroundColor: colors.success }}
        >
          <Text
            className="font-semibold"
            style={{ color: colors.primaryForeground }}
          >
            {isSubmitting
              ? 'Generating Recommendations...'
              : 'Submit My Choices'}
          </Text>
        </Button>
      </View>
    </ScrollView>
  );
}
