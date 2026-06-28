import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Target,
} from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import { areaByUrlName, AREA_QUESTIONS } from '@/lib/growthAreaData';
import { buildGrowthAreaRecommendationsPrompt } from '@/lib/prompts';
import type { Question } from '@/lib/growthAreaData';
import { useSlideUpWhenReady } from '@/lib/animations';
import {
  GradientIconBox,
  GradientButton,
  areaGrad,
} from '@/components/shared/GradientView';
import type { GrowthStackParamList } from '@/navigation';
import { useJob } from '@/hooks/useJob';

type GrowthNavProp = StackNavigationProp<
  GrowthStackParamList,
  'GrowthAreasGreatInsights'
>;
type GrowthRouteProp = RouteProp<
  GrowthStackParamList,
  'GrowthAreasGreatInsights'
>;

// Inlined from ChildActivityGame — normalises the LLM blob so `suggested_activities`
// is always the canonical key.
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

type GameResults = {
  summary?: string;
  strengths?: string[];
  suggested_activities?: string[];
};

// ── Double-ring spinner — mirrors web CSS double-ring animation ───────────────
function DoubleRingSpinner() {
  const { colors } = useTheme();
  const rot1 = useSharedValue(0);
  const rot2 = useSharedValue(0);

  useEffect(() => {
    rot1.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
    rot2.value = withRepeat(
      withTiming(-360, { duration: 700, easing: Easing.linear }),
      -1,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style1 = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot1.value}deg` }],
  }));
  const style2 = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot2.value}deg` }],
  }));

  return (
    <View style={{ width: 64, height: 64 }}>
      {/* Outer track */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderRadius: 32,
          borderWidth: 4,
          borderColor: `${colors.success}33`,
        }}
      />
      {/* Outer spinner */}
      <Animated.View
        style={[
          style1,
          {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderRadius: 32,
            borderWidth: 4,
            borderColor: 'transparent',
            borderTopColor: colors.primary,
          },
        ]}
      />
      {/* Inner spinner (reverse, faster) */}
      <Animated.View
        style={[
          style2,
          {
            position: 'absolute',
            top: 8,
            right: 8,
            bottom: 8,
            left: 8,
            borderRadius: 24,
            borderWidth: 4,
            borderColor: 'transparent',
            borderTopColor: colors.success,
          },
        ]}
      />
    </View>
  );
}

// ── Staggered recommendation row ─────────────────────────────────────────────
function AnimatedRecItem({
  rec,
  index,
  areaColor,
}: {
  rec: string;
  index: number;
  areaColor: string;
}) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-16);

  useEffect(() => {
    const delay = index * 100;
    const cfg = { duration: 500, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    translateX.value = withDelay(delay, withTiming(0, cfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  const { from, to } = areaGrad(areaColor);

  return (
    <Animated.View
      style={[
        style,
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
          borderRadius: 12,
          padding: 12,
          backgroundColor: colors.muted,
        },
      ]}
    >
      <GradientIconBox from={from} to={to} size={24} radius={8} diagonal>
        <Text
          className="text-xs font-bold"
          style={{ color: colors.primaryForeground }}
        >
          {index + 1}
        </Text>
      </GradientIconBox>
      <Text
        className="flex-1 text-sm leading-relaxed"
        style={{ color: colors.textMuted }}
      >
        {rec}
      </Text>
    </Animated.View>
  );
}

export default function GrowthAreasGreatInsightsScreen() {
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

  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState<string | null>(null);
  const [childGender, setChildGender] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<string[] | null>(null);
  const [interactiveAnswers, setInteractiveAnswers] = useState<
    Record<string, unknown>
  >({});
  const [childGameResults, setChildGameResults] = useState<GameResults | null>(
    null,
  );
  // loading → initial DB fetch | idle → no cached recs, waiting for button
  // ready → recs available | error → load failed
  const [status, setStatus] = useState('loading');
  // Stores the area entry data pre-saved before enqueueing so the onCompleted callback can finalize it.
  const pendingAreaDataRef = useRef<Record<string, unknown> | null>(null);
  // Snapshot the childId at enqueue time so that if the user switches the active child
  // while the job is polling, finalizeRecommendations still writes to the child the job
  // was started for — not whoever happens to be active when the poll completes.
  //
  // This is RN-specific: the navigation stack keeps this screen mounted in memory even
  // when the user navigates away, so activeChildId can drift. The web version
  // (GrowthAreasActivityGreatInsights.tsx) omits this ref intentionally — React Router
  // unmounts the page on navigation, which tears down the poll via useEffect cleanup,
  // making the drift impossible. Do NOT remove this ref assuming it is dead code.
  const enqueueChildIdRef = useRef<string | null>(null);

  const contentStyle = useSlideUpWhenReady(
    !isLoadingAuth && status !== 'loading',
  );

  const finalizeRecommendations = useCallback(async () => {
    const childId = enqueueChildIdRef.current ?? activeChildId;
    if (!childId || !area) return;
    try {
      const completedData = await api.completedGrowthAreas.list(childId);
      const allDocs = completedData.areas ?? [];
      const areaDoc = allDocs.find(a => a.area_id === area.id);
      const pendingRaw = areaDoc?.pending_recommendations as
        | Record<string, unknown>
        | undefined;
      const pending = Array.isArray(pendingRaw)
        ? (pendingRaw as string[])
        : Array.isArray(pendingRaw?.recommendations)
        ? (pendingRaw.recommendations as string[])
        : undefined;
      if (pending && pending.length > 0) {
        setRecommendations(pending);
        setStatus('ready');
        await api.completedGrowthAreas.append(childId, {
          ...(pendingAreaDataRef.current ?? {}),
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          status: 'completed',
          step: 'activity_summary',
          ai_three_month_recommendations: pending,
        });
        pendingAreaDataRef.current = null;
      } else {
        setStatus('ready');
      }
    } catch (err) {
      console.error(
        '[GrowthAreasGreatInsightsScreen] Failed to finalize recommendations:',
        err,
      );
      toast.error('Recommendations are ready — refresh to see them.');
    }
  }, [activeChildId, area]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_recommendations',
    onCompleted: finalizeRecommendations,
  });
  const { enqueue: jobEnqueue } = job;

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
        if (child.age != null) setChildAge(String(child.age));
        if (typeof child.gender === 'string') setChildGender(child.gender);
        setChildData(child as Record<string, unknown>);

        const completedData = await api.completedGrowthAreas.list(child.id);
        if (cancelled) return;
        const allDocs = completedData.areas ?? [];
        const areaDoc =
          allDocs.find(
            a => a.area_id === area.id && a.status === 'in_progress',
          ) ?? allDocs.find(a => a.area_id === area.id);

        const ia = areaDoc?.interactive_answers ?? {};
        setInteractiveAnswers(ia);

        const childActivity = areaDoc?.child_activity;
        const rawGameResults = childActivity?.results;
        if (rawGameResults) {
          setChildGameResults(
            normalizeChildGameRecommendations(rawGameResults) as GameResults,
          );
        }

        // DB hit: recommendations already exist — show immediately
        const aiRecs = areaDoc?.ai_three_month_recommendations;
        const recs = areaDoc?.recommendations;
        const cached =
          Array.isArray(aiRecs) && aiRecs.length > 0
            ? aiRecs
            : Array.isArray(recs) && recs.length > 0
            ? recs
            : null;

        if (cached) {
          setRecommendations(cached);
          setStatus('ready');
          return;
        }

        setStatus('idle');
      } catch (err) {
        console.warn('[GrowthAreasGreatInsightsScreen] Load failed:', err);
        if (!cancelled) setStatus('error');
      } finally {
        if (!cancelled) setStatus(prev => (prev === 'loading' ? 'idle' : prev));
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

  const isGenerating = job.isLoading || (job.isComplete && status !== 'ready');
  const isError = status === 'error' || job.isFailed;

  const generateRecommendations = useCallback(async () => {
    if (!area || !activeChildId) return;

    const questions: Question[] = AREA_QUESTIONS[area.id] ?? [];
    const qaContext = questions
      .filter(q => interactiveAnswers[q.id])
      .map(
        q =>
          `Q: ${q.question.replace(
            /\{name\}/g,
            childName || 'the child',
          )}\nA: ${String(interactiveAnswers[q.id])}`,
      )
      .join('\n\n');

    try {
      // Pre-save area entry with answers so the worker's write_back has a doc to update.
      await api.completedGrowthAreas.append(activeChildId, {
        area_id: area.id,
        area_name: area.name,
        area_color: area.color,
        answers: interactiveAnswers,
        status: 'in_progress',
        step: 'activity_summary',
        interactive_answers: interactiveAnswers,
      });
      pendingAreaDataRef.current = {
        answers: interactiveAnswers,
        interactive_answers: interactiveAnswers,
      };
      enqueueChildIdRef.current = activeChildId;

      await jobEnqueue({
        type: 'generate_recommendations',
        child_id: activeChildId,
        payload: {
          prompt: buildGrowthAreaRecommendationsPrompt({
            childName: childName || 'the child',
            childAge,
            childGender,
            areaName: area.name,
            qaContext,
            childGameSummary: childGameResults?.summary ?? null,
            childGameStrengths: childGameResults?.strengths ?? null,
            childGameSuggestedActivities:
              childGameResults?.suggested_activities ?? null,
          }),
          response_json_schema: {
            type: 'object',
            properties: {
              recommendations: {
                type: 'array',
                items: { type: 'string' },
                minItems: 5,
                maxItems: 5,
              },
            },
          },
        },
        write_back: {
          collection: 'growth_areas',
          filter: { area_id: area.id },
          field: 'pending_recommendations',
        },
      });
    } catch (err) {
      console.error(
        '[GrowthAreasGreatInsightsScreen] Failed to enqueue recommendations:',
        err,
      );
      toast.error('Could not generate recommendations. Please try again.');
    }
  }, [
    area,
    activeChildId,
    childName,
    childAge,
    childGender,
    interactiveAnswers,
    childGameResults,
    jobEnqueue,
  ]);

  if (isLoadingAuth || status === 'loading') {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.background }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !area) {
    return (
      <View
        className="flex-1 items-center justify-center gap-4 px-4"
        style={{ backgroundColor: colors.background }}
      >
        <Text style={{ color: colors.textMuted }}>
          Could not load insights. Please try again.
        </Text>
        <Button
          onPress={() => navigation.navigate('GrowthAreas')}
          className="rounded-2xl px-8"
        >
          <Text style={{ color: colors.primaryForeground }}>
            Back to Growth Areas
          </Text>
        </Button>
      </View>
    );
  }

  const Icon = area.icon;
  const { from: gradFrom, to: gradTo } = areaGrad(area.color);

  // Q&A summary rows
  const questions: Question[] = AREA_QUESTIONS[area.id] ?? [];
  const answeredQuestions = questions.filter(q => interactiveAnswers[q.id]);

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
            from={gradFrom}
            to={gradTo}
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
            {area.name} — Great Insights
          </Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 32,
          paddingBottom: 40,
          gap: 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header — gradient area icon + title */}
        <View className="items-center">
          <GradientIconBox
            from={gradFrom}
            to={gradTo}
            size={80}
            radius={20}
            diagonal
          >
            <Icon size={40} color={colors.primaryForeground} />
          </GradientIconBox>
          <Text
            className="mb-2 text-2xl font-bold mt-4"
            style={{ color: colors.text }}
          >
            Great Insights!
          </Text>
          <Text style={{ color: colors.textMuted }}>
            Here's what we learned about {childName}'s {area.name}
          </Text>
        </View>

        <View className="gap-6">
          {/* Q&A summary */}
          {answeredQuestions.length > 0 && (
            <View
              className="gap-3 rounded-2xl p-6"
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
              }}
            >
              {answeredQuestions.map(q => {
                const answerVal = interactiveAnswers[q.id];
                return (
                  <View
                    key={q.id}
                    className="border-b pb-3 last:border-0 last:pb-0"
                    style={{ borderColor: colors.border }}
                  >
                    <Text
                      className="mb-1 text-xs"
                      style={{ color: colors.iconColor }}
                    >
                      {q.question.replace(
                        /\{name\}/g,
                        childName || 'your child',
                      )}
                    </Text>
                    <Text
                      className="text-sm font-medium"
                      style={{ color: colors.text }}
                    >
                      {typeof answerVal === 'string' ? answerVal : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Child game results — bg-surface-elevated sub-cards (matches web) */}
          {childGameResults && (
            <View
              className="gap-4 rounded-2xl p-6"
              style={{
                borderWidth: 1,
                borderColor: colors.success + '33',
                backgroundColor: colors.card,
              }}
            >
              <View className="mb-2 flex-row items-center gap-2">
                {/* Always emerald→teal, mirrors web's from-emerald-500 to-teal-600 */}
                <GradientIconBox
                  from={colors.primary}
                  to={colors.primaryDark}
                  size={40}
                  radius={20}
                  diagonal
                >
                  <Sparkles size={20} color={colors.primaryForeground} />
                </GradientIconBox>
                <Text className="font-bold" style={{ color: colors.text }}>
                  Recommendations for {childName}
                </Text>
              </View>

              {childGameResults.summary ? (
                <View
                  className="rounded-xl p-4"
                  style={{ backgroundColor: colors.surfaceElevated }}
                >
                  <Text
                    className="mb-2 font-semibold"
                    style={{ color: colors.text }}
                  >
                    What This Reveals
                  </Text>
                  <Text className="text-sm" style={{ color: colors.textMuted }}>
                    {childGameResults.summary}
                  </Text>
                </View>
              ) : null}

              {Array.isArray(childGameResults.suggested_activities) &&
              childGameResults.suggested_activities.length > 0 ? (
                <View
                  className="rounded-xl p-4"
                  style={{ backgroundColor: colors.surfaceElevated }}
                >
                  <Text
                    className="mb-2 font-semibold"
                    style={{ color: colors.text }}
                  >
                    Suggested Activities
                  </Text>
                  <View className="gap-2">
                    {childGameResults.suggested_activities.map(act => (
                      <View key={act} className="flex-row items-start gap-2">
                        <Text style={{ color: colors.success }}>✓</Text>
                        <Text
                          className="flex-1 text-sm"
                          style={{ color: colors.textMuted }}
                        >
                          {act}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {Array.isArray(childGameResults.strengths) &&
              childGameResults.strengths.length > 0 ? (
                <View
                  className="rounded-xl p-4"
                  style={{ backgroundColor: colors.surfaceElevated }}
                >
                  <Text
                    className="mb-2 font-semibold"
                    style={{ color: colors.text }}
                  >
                    Strengths to Encourage
                  </Text>
                  <View className="gap-2">
                    {childGameResults.strengths.map(s => (
                      <View key={s} className="flex-row items-start gap-2">
                        <Text style={{ color: colors.success }}>★</Text>
                        <Text
                          className="flex-1 text-sm"
                          style={{ color: colors.textMuted }}
                        >
                          {s}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          )}

          {/* 3-month recommendations */}
          <View
            className="rounded-2xl p-6"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <View className="mb-4 flex-row items-center gap-2">
              <Target size={20} color={colors.success} />
              <Text className="font-semibold" style={{ color: colors.text }}>
                3-Month Recommendations for {area.name}
              </Text>
            </View>

            {/* Idle — generate button */}
            {status === 'idle' && !isGenerating && (
              <GradientButton
                from={colors.primary}
                to={colors.primaryDark}
                height={44}
                borderRadius={16}
                onPress={() => {
                  void generateRecommendations();
                }}
                style={{ width: '100%' }}
              >
                <View className="flex-row items-center gap-2">
                  <Sparkles size={16} color={colors.primaryForeground} />
                  <Text
                    style={{
                      fontWeight: '600',
                      color: colors.primaryForeground,
                    }}
                  >
                    Generate Recommendations
                  </Text>
                </View>
              </GradientButton>
            )}

            {/* Generating — double-ring spinner (mirrors web) */}
            {isGenerating && (
              <View className="items-center gap-5 py-10">
                <DoubleRingSpinner />
                <View className="items-center gap-1">
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: colors.text }}
                  >
                    Building your 3-Month Plan
                  </Text>
                  <Text className="text-xs" style={{ color: colors.iconColor }}>
                    Personalising recommendations for {childName}…
                  </Text>
                </View>
              </View>
            )}

            {/* Ready — staggered recommendation list */}
            {Array.isArray(recommendations) && recommendations.length > 0 && (
              <View className="gap-3">
                {recommendations.map((rec, i) => (
                  <AnimatedRecItem
                    key={i}
                    rec={rec}
                    index={i}
                    areaColor={area.color}
                  />
                ))}
              </View>
            )}
          </View>

          {/* Navigation */}
          <View className="gap-3 pt-4">
            <GradientButton
              from={gradFrom}
              to={gradTo}
              height={48}
              borderRadius={16}
              onPress={() => navigation.navigate('GrowthAreas')}
              style={{ width: '100%' }}
            >
              <View className="flex-row items-center gap-1.5">
                <Text
                  style={{ fontWeight: '600', color: colors.primaryForeground }}
                >
                  Done
                </Text>
                <ChevronRight size={16} color={colors.primaryForeground} />
              </View>
            </GradientButton>

            <Button
              size="xl"
              variant="outline"
              onPress={() => navigation.navigate('GrowthAreas')}
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
        </View>
      </ScrollView>
    </Animated.View>
  );
}
