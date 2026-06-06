/**
 * GrowthAreasActivityGameScreen
 *
 * Phase 5 RN port of GrowthAreasActivityGame.tsx.
 *
 * The web version uses ChildActivityGame (a grid of image/emoji tiles).
 * Since ChildActivityGame has not yet been ported to RN, this screen inlines
 * a simplified tile-grid using FlatList (no drag functionality — Phase 6 adds
 * react-native-draggable-flatlist). All state, API, and callback logic is
 * preserved identically.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, {
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
  Defs,
} from 'react-native-svg';
import { useSlideUpWhenReady } from '@/lib/animations';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import { ChevronLeft, CheckCircle, Circle } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';
import { env } from '@/lib/env';
import { areaByUrlName, AREA_QUESTIONS } from '@/lib/growthAreaData';
import {
  GradientIconBox,
  GradientButton,
  areaGrad,
  tileGrad,
} from '@/components/shared/GradientView';
import type { GrowthStackParamList } from '@/navigation';

type GrowthNavProp = StackNavigationProp<
  GrowthStackParamList,
  'GrowthAreasActivityGame'
>;
type GrowthRouteProp = RouteProp<
  GrowthStackParamList,
  'GrowthAreasActivityGame'
>;

// ---------------------------------------------------------------------------
// Inline game data (mirrors ChildActivityGame.tsx until a shared RN version exists)
// ---------------------------------------------------------------------------

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

const TILE_COLORS = [
  'from-purple-400 to-indigo-500',
  'from-rose-400 to-pink-500',
  'from-amber-400 to-orange-500',
  'from-emerald-400 to-teal-500',
  'from-blue-400 to-cyan-500',
  'from-violet-400 to-purple-500',
];

const areaGames: Record<string, AreaGame> = {
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
    promptContext: labels =>
      `A child has selected these career aspirations: ${labels.join(
        ', ',
      )}. Generate personalized recommendations for the parent to help nurture these interests: 1. A brief summary of what these choices reveal about the child's interests, 2. 3-4 specific activities or experiences to support these aspirations, 3. 2-3 strengths to encourage based on these choices.`,
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
    promptContext: labels =>
      `A child has chosen these self-care activities as things that make them feel calm and happy: ${labels.join(
        ', ',
      )}. Generate personalized self-care recommendations for the parent: 1. A brief summary of what these choices reveal about the child's emotional needs, 2. 3-4 specific ways to support these self-care habits at home, 3. 2-3 emotional strengths to encourage.`,
  },
  critical_thinking: {
    question: 'Which activity does [child name] enjoy the most?',
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
    promptContext: labels =>
      `A child has chosen these thinking challenges as their favourites: ${labels.join(
        ', ',
      )}. Generate personalized recommendations for the parent to develop their critical thinking: 1. A brief summary of what these choices reveal about the child's thinking style, 2. 3-4 specific activities to sharpen these skills, 3. 2-3 cognitive strengths to encourage.`,
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
    promptContext: labels =>
      `A child has chosen these creative activities as their favourites: ${labels.join(
        ', ',
      )}. Generate personalized recommendations for the parent to nurture their creativity: 1. A brief summary of what these choices reveal about the child's creative personality, 2. 3-4 specific ways to encourage and develop these creative skills, 3. 2-3 creative strengths to celebrate.`,
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
    promptContext: labels =>
      `A child has chosen these physical activities as their favourites: ${labels.join(
        ', ',
      )}. Generate personalized physical wellness recommendations for the parent: 1. A brief summary of what these choices reveal about the child's physical personality, 2. 3-4 specific ways to support and grow these physical habits, 3. 2-3 physical strengths to encourage.`,
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
    promptContext: labels =>
      `A child has identified these social situations as most natural to them: ${labels.join(
        ', ',
      )}. Generate personalized social skills recommendations for the parent: 1. A brief summary of what these choices reveal about the child's social personality, 2. 3-4 specific activities to strengthen their social skills, 3. 2-3 social strengths to celebrate.`,
  },
};

function normalizeChildGameRecommendations(
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

// ---------------------------------------------------------------------------
// Screen component
// ---------------------------------------------------------------------------

export default function GrowthAreasActivityGameScreen() {
  const navigation = useNavigation<GrowthNavProp>();
  const { colors } = useTheme();
  const route = useRoute<GrowthRouteProp>();
  const { activityId } = route.params as { activityId: string };
  const {
    activeChildId,
    isAuthenticated,
    isLoading: isLoadingAuth,
  } = useAuth();

  const area = areaByUrlName(activityId ?? '');

  const [childName, setChildName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savedAnswers, setSavedAnswers] = useState<Record<string, unknown>>({});
  const [hydrated, setHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const game = useMemo(
    () =>
      area
        ? areaGames[area.id] ?? areaGames['life_ambition']!
        : areaGames['life_ambition']!,
    [area],
  );

  const contentStyle = useSlideUpWhenReady(!isLoadingAuth && hydrated);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) return;
    if (!activeChildId) return;
    if (!area) {
      navigation.goBack();
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(activeChildId);
        if (cancelled) return;
        if (!child) return;

        setChildName(child.name ?? '');

        const completedData = await api.completedGrowthAreas.list(child.id);
        if (cancelled) return;
        const allDocs = completedData.areas ?? [];
        const areaDoc = allDocs.find(a => a.area_id === area.id);
        const childActivity = areaDoc?.child_activity;
        const saved =
          (childActivity?.['selections'] as string[] | undefined) ??
          areaDoc?.child_activity_selections ??
          [];
        if (Array.isArray(saved) && saved.length > 0) setSelectedIds(saved);
        const ia = areaDoc?.interactive_answers;
        if (ia) setSavedAnswers(ia);
      } catch (err) {
        console.warn('[GrowthAreasActivityGameScreen] Load failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isLoadingAuth,
    isAuthenticated,
    activeChildId,
    activityId,
    area,
    navigation,
  ]);

  const toggleSelection = useCallback(
    (id: string) => {
      if (selectedIds.includes(id)) {
        const next = selectedIds.filter(s => s !== id);
        setSelectedIds(next);
        void handleSelectedIdsChange(next);
      } else if (selectedIds.length < game.maxSelections) {
        const next = [...selectedIds, id];
        setSelectedIds(next);
        void handleSelectedIdsChange(next);
      } else {
        toast.error(`You can select maximum ${game.maxSelections} options`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, game.maxSelections],
  );

  const handleSelectedIdsChange = useCallback(
    async (ids: string[]) => {
      if (!activeChildId || !area) return;
      try {
        await api.completedGrowthAreas.append(activeChildId, {
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          answers: savedAnswers,
          status: 'in_progress',
          step: 'activity_summary',
          child_activity_selections: ids,
        });
      } catch {
        /* non-fatal */
      }
    },
    [activeChildId, area, savedAnswers],
  );

  const handleGameComplete = useCallback(
    async (result: Record<string, unknown>) => {
      if (!activeChildId || !area) return;
      try {
        await api.completedGrowthAreas.append(activeChildId, {
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          answers: savedAnswers,
          status: 'in_progress',
          step: 'activity_summary',
          child_activity: {
            selections: result.selections ?? [],
            results: result.recommendations ?? null,
          },
          child_activity_selections: result.selections ?? [],
        });
      } catch (err) {
        console.error('[GrowthAreasActivityGameScreen] Save failed:', err);
        toast.error(
          'Could not save game results. Try again or check your connection.',
        );
        return;
      }
      navigation.navigate('GrowthAreasGreatInsights', { activityId });
    },
    [activeChildId, area, activityId, navigation, savedAnswers],
  );

  const handleSubmit = useCallback(async () => {
    if (selectedIds.length === 0) {
      toast.error('Please select at least 1 option');
      return;
    }

    setIsSubmitting(true);

    try {
      // Check DB first — skip LLM if results already saved
      const completedData = (await api.completedGrowthAreas.list(
        activeChildId ?? '',
      )) as Record<string, unknown>;
      const areasArr = Array.isArray(
        (completedData as { areas?: unknown }).areas,
      )
        ? (completedData as { areas: Array<Record<string, unknown>> }).areas
        : [];
      const existing = areasArr.find(a => a.area_id === area?.id);
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
          : selectedIds;
        await handleGameComplete({
          selections: existingSelections,
          recommendations,
        });
        setIsSubmitting(false);
        return;
      }
    } catch (err) {
      console.warn(
        '[GrowthAreasActivityGameScreen] Cached result fetch failed, falling through to LLM:',
        err,
      );
    }

    const selectedLabels = selectedIds.map(
      id => game.options.find(o => o.id === id)?.label ?? id,
    );

    try {
      const raw = await api.integrations.Core.InvokeLLM({
        prompt: `A child named ${childName} has made the following selections.\n\n${game.promptContext(
          selectedLabels,
        )}`,
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
      await handleGameComplete({ selections: selectedIds, recommendations });
    } catch (err) {
      console.error(
        '[GrowthAreasActivityGameScreen] Recommendation generation failed:',
        err,
      );
      toast.error('Could not generate recommendations. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, activeChildId, area, childName, game, handleGameComplete]);

  if (isLoadingAuth || !hydrated) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.background }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!area) {
    return null;
  }

  const Icon = area.icon;

  return (
    <Animated.View
      style={[contentStyle, { backgroundColor: colors.background }]}
      className="flex-1"
    >
      {/* Area header */}
      <View
        className="border-b px-4 py-3"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <View className="flex-row items-center gap-3">
          <GradientIconBox
            from={areaGrad(area.color).from}
            to={areaGrad(area.color).to}
            size={36}
            radius={12}
            diagonal
          >
            <Icon size={20} color={colors.primaryForeground} />
          </GradientIconBox>
          <Text
            className="text-sm font-semibold"
            style={{ color: colors.text }}
          >
            {area.name} — Activity
          </Text>
        </View>
      </View>

      <FlatList
        className="flex-1"
        contentContainerClassName="px-4 py-8"
        showsVerticalScrollIndicator={false}
        data={game.options}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperClassName="gap-4 mb-4"
        ListHeaderComponent={
          <View className="mb-6 items-center">
            <Text
              className="mb-2 text-2xl font-bold"
              style={{ color: colors.text }}
            >
              {game.question.replace(
                '[child name]',
                childName?.trim() || 'your child',
              )}
            </Text>
            <Text style={{ color: colors.iconColor }}>{game.subtitle}</Text>
            <Text className="mt-2 text-sm" style={{ color: colors.success }}>
              Selected: {selectedIds.length}/{game.maxSelections}
            </Text>
          </View>
        }
        renderItem={({ item: option, index }) => {
          const isSelected = selectedIds.includes(option.id);
          const tileColor =
            TILE_COLORS[index % TILE_COLORS.length] ?? TILE_COLORS[0]!;
          const { from: tFrom, to: tTo } = tileGrad(tileColor);
          const imageUrl = option.image
            ? `${env.CDN_BASE_URL}/app-assets/${option.image}`
            : undefined;
          return (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => toggleSelection(option.id)}
              style={{
                flex: 1,
                overflow: 'hidden',
                borderRadius: 16,
                borderWidth: 4,
                borderColor: isSelected ? colors.success : colors.border,
              }}
            >
              {/* Tile — S3 image with gradient+emoji fallback */}
              <GradientTile
                from={tFrom}
                to={tTo}
                imageUrl={imageUrl}
                emoji={option.emoji}
              />
              {/* Label row */}
              <View className="flex-row items-center justify-between bg-black/60 px-3 py-2">
                <Text
                  className="text-sm font-semibold"
                  style={{ color: colors.primaryForeground }}
                >
                  {option.label}
                </Text>
                {isSelected ? (
                  <CheckCircle
                    size={20}
                    color={colors.success}
                    fill={colors.success}
                  />
                ) : (
                  <Circle size={20} color={colors.textMuted} />
                )}
              </View>
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={
          <View className="mt-6 gap-3">
            {/* Gradient submit button */}
            <GradientButton
              from={colors.primary}
              to={colors.primaryDark}
              height={48}
              borderRadius={16}
              disabled={selectedIds.length === 0 || isSubmitting}
              loading={isSubmitting}
              onPress={() => {
                void handleSubmit();
              }}
              style={{ width: '100%' }}
            >
              <Text
                style={{ fontWeight: '600', color: colors.primaryForeground }}
              >
                {isSubmitting
                  ? 'Generating Recommendations...'
                  : 'Submit My Choices'}
              </Text>
            </GradientButton>

            <Button
              variant="outline"
              onPress={() => {
                const questions = AREA_QUESTIONS[area.id] ?? [];
                navigation.navigate('GrowthAreasActivity', { activityId });
                void questions;
              }}
              className="w-full rounded-2xl"
            >
              <View className="flex-row items-center gap-1.5">
                <ChevronLeft size={16} color={colors.textMuted} />
                <Text
                  className="text-base font-medium"
                  style={{ color: colors.textMuted }}
                >
                  Back
                </Text>
              </View>
            </Button>
          </View>
        }
      />
    </Animated.View>
  );
}

// ── GradientTile ──────────────────────────────────────────────────────────────
// Aspect-ratio-1 tile that renders an S3 image when available.
// Falls back to an SVG diagonal gradient + large emoji if the image is absent
// or fails to load — mirrors web ChildActivityGame.tsx's _failedAssetPaths pattern.

function GradientTile({
  from,
  to,
  imageUrl,
  emoji,
}: {
  from: string;
  to: string;
  imageUrl?: string;
  emoji: string;
}) {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [imgFailed, setImgFailed] = useState(false);

  const showImage = !!imageUrl && !imgFailed && dims.w > 0 && dims.h > 0;

  return (
    <View
      style={{
        aspectRatio: 1,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
      onLayout={e =>
        setDims({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      {/* Gradient background — always rendered; visible when no image or image fails */}
      {dims.w > 0 && dims.h > 0 && (
        <Svg
          width={dims.w}
          height={dims.h}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <Defs>
            <SvgLinearGradient id="tileGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={from} />
              <Stop offset="100%" stopColor={to} />
            </SvgLinearGradient>
          </Defs>
          <Rect width={dims.w} height={dims.h} fill="url(#tileGrad)" />
        </Svg>
      )}

      {/* S3 image — covers gradient when loaded successfully */}
      {imageUrl && dims.w > 0 && dims.h > 0 && !imgFailed && (
        <Image
          source={{ uri: imageUrl }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: dims.w,
            height: dims.h,
          }}
          resizeMode="cover"
          onError={() => setImgFailed(true)}
        />
      )}

      {/* Emoji fallback — shown when no image or image fails */}
      {!showImage && <Text style={{ fontSize: 40 }}>{emoji}</Text>}
    </View>
  );
}
