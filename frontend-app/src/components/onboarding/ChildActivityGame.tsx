import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, FlatList, Pressable, Image } from 'react-native';
import { CheckCircle, Circle } from 'lucide-react-native';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';
import { env } from '@/lib/env';
import { useTheme } from '@/lib/ThemeContext';
import Svg, {
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
  Defs,
} from 'react-native-svg';
import { GradientButton, tileGrad } from '@/components/shared/GradientView';

// Session-level cache of asset paths that have previously failed to load.
// Lives outside the component so it survives remounts and app-level rerenders.
const _failedAssetPaths = new Set<string>();

function themedImagePath(path: string, isDark: boolean): string {
  return path.replace(/\.jpg$/, isDark ? '_vg_dark.png' : '_vg_light.png');
}

const TILE_COLORS = [
  'from-purple-400 to-indigo-500',
  'from-rose-400 to-pink-500',
  'from-amber-400 to-orange-500',
  'from-emerald-400 to-teal-500',
  'from-blue-400 to-cyan-500',
  'from-violet-400 to-purple-500',
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
    question: 'What does [child name] want to become when they grow up?',
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
    question: 'Which activities make [child name] feel calm and happy?',
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
    promptContext: (labels: string[], childAge?, childGender?, childName?) =>
      `${childName ?? 'A child'} (${childAge ?? 'school-age'}-year-old ${
        childGender ?? 'child'
      }) has chosen these thinking challenges as their favourites: ${labels.join(
        ', ',
      )}. These selections will be used to generate a personalised critical thinking development plan for the parent.\n\nReturn ONLY a valid JSON object with exactly these three fields (use these exact key names):\n- "summary": one sentence describing what these choices reveal about this child's thinking style and cognitive preferences, considering their age and gender.\n- "suggested_activities": an array of 3–4 specific, age-appropriate activities to sharpen these critical thinking skills. IMPORTANT: the key must be "suggested_activities" exactly.\n- "strengths": an array of 2–3 cognitive strengths these choices suggest the child has or is developing.`,
  },
  creativity: {
    question: 'Which creative activities does [child name] love?',
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
    question: 'Which physical activities does [child name] enjoy?',
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
    question: 'Which situations feel most natural to [child name]?',
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
  onSubmitIds?: (
    ids: string[],
    prompt: string,
    schema: Record<string, unknown>,
  ) => Promise<void>;
  isExternallyLoading?: boolean;
  /** Optional extra content rendered below the submit button (e.g. a Back button). */
  footerExtra?: React.ReactNode;
}

const ACTIVITY_SCHEMA = {
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
};

export default function ChildActivityGame({
  childName,
  childAge,
  childGender,
  areaId = 'life_ambition',
  activeChildId,
  selectedIds = [],
  onSelectedIdsChange,
  onComplete,
  onSubmitIds,
  isExternallyLoading = false,
  footerExtra,
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
      // Check DB first — skip LLM/job if results already saved for this area
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

    if (onSubmitIds) {
      try {
        await onSubmitIds(
          ids,
          game.promptContext(selectedLabels, childAge, childGender, childName),
          ACTIVITY_SCHEMA,
        );
      } catch {
        // error already handled by the parent
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    try {
      const raw = await api.integrations.Core.InvokeLLM({
        prompt: game.promptContext(
          selectedLabels,
          childAge,
          childGender,
          childName,
        ),
        response_json_schema: ACTIVITY_SCHEMA,
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
            className="mb-2 text-center text-2xl font-bold"
            style={{ color: colors.text }}
          >
            {game.question.replace(
              '[child name]',
              childName?.trim() || 'your child',
            )}
          </Text>
          <Text style={{ color: colors.iconColor }}>{game.subtitle}</Text>
          <Text className="mt-2 text-sm" style={{ color: colors.success }}>
            Selected: {ids.length}/{game.maxSelections}
          </Text>
        </View>
      }
      renderItem={({ item: option, index }) => {
        const isSelected = ids.includes(option.id);
        const hasFailed = failedImages.has(option.id);
        const tileColor =
          TILE_COLORS[index % TILE_COLORS.length] ?? TILE_COLORS[0]!;
        const { from: tFrom, to: tTo } = tileGrad(tileColor);
        const imageUrl = !hasFailed
          ? `${env.CDN_BASE_URL}/app-assets/${themedImagePath(
              option.image,
              isDark,
            )}`
          : undefined;
        return (
          <Pressable
            onPress={() => toggleSelection(option.id)}
            style={{
              flex: 1,
              overflow: 'hidden',
              borderRadius: 16,
              borderWidth: 4,
              borderColor: isSelected ? colors.success : colors.border,
            }}
            android_ripple={{ color: colors.ripple }}
          >
            <GradientTile
              from={tFrom}
              to={tTo}
              imageUrl={imageUrl}
              emoji={option.emoji}
              onImageError={() => {
                _failedAssetPaths.add(option.image);
                setFailedImages(prev => new Set([...prev, option.id]));
              }}
            />
            <View
              className="flex-row items-center justify-between px-3 py-2"
              style={{ backgroundColor: colors.imageScrimColor }}
            >
              <Text
                className="text-sm font-semibold flex-1 mr-1"
                style={{ color: colors.primaryForeground }}
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
                <Circle size={22} color={colors.textMuted} />
              )}
            </View>
          </Pressable>
        );
      }}
      ListFooterComponent={
        <View className="mt-6 gap-3">
          <GradientButton
            from={colors.primary}
            to={colors.primaryDark}
            height={48}
            borderRadius={16}
            disabled={ids.length === 0 || isSubmitting || isExternallyLoading}
            loading={isSubmitting || isExternallyLoading}
            onPress={() => {
              void handleSubmit();
            }}
          >
            <Text
              style={{ fontWeight: '600', color: colors.primaryForeground }}
            >
              {isSubmitting || isExternallyLoading
                ? 'Generating Recommendations...'
                : 'Submit My Choices'}
            </Text>
          </GradientButton>
          {footerExtra}
        </View>
      }
    />
  );
}

// ── GradientTile ──────────────────────────────────────────────────────────────
// Aspect-ratio 4:3 tile that renders an S3 image when available.
// Falls back to an SVG diagonal gradient + large emoji if the image is absent
// or fails to load — mirrors web ChildActivityGame.tsx's _failedAssetPaths pattern.

export function GradientTile({
  from,
  to,
  imageUrl,
  emoji,
  onImageError,
}: {
  from: string;
  to: string;
  imageUrl?: string;
  emoji: string;
  onImageError?: () => void;
}) {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [imgFailed, setImgFailed] = useState(false);

  const showImage = !!imageUrl && !imgFailed && dims.w > 0 && dims.h > 0;

  return (
    <View
      style={{
        aspectRatio: 4 / 3,
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
          onError={() => {
            setImgFailed(true);
            onImageError?.();
          }}
        />
      )}

      {/* Emoji fallback — shown when no image or image fails */}
      {!showImage && <Text style={{ fontSize: 40 }}>{emoji}</Text>}
    </View>
  );
}
