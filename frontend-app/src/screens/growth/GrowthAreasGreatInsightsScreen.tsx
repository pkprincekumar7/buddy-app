import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
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
import { Sparkles, ChevronLeft, ChevronRight, Target } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { areaByUrlName, AREA_QUESTIONS } from '@/lib/growthAreaData';
import type { Question } from '@/lib/growthAreaData';
import { useSlideUpWhenReady } from '@/lib/animations';
import { GradientIconBox, GradientButton, areaGrad } from '@/components/shared/GradientView';
import type { GrowthStackParamList } from '@/navigation';

type GrowthNavProp = StackNavigationProp<GrowthStackParamList, 'GrowthAreasGreatInsights'>;
type GrowthRouteProp = RouteProp<GrowthStackParamList, 'GrowthAreasGreatInsights'>;

// Inlined from ChildActivityGame — normalises the LLM blob so `suggested_activities`
// is always the canonical key.
function normalizeChildGameRecommendations(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return raw as Record<string, unknown>;
  const rawObj = raw as Record<string, unknown>;
  const suggested = Array.isArray(rawObj.suggested_activities)
    ? [...(rawObj.suggested_activities as unknown[])]
    : [];
  const { activities: _a, suggested_activities: _s, ...rest } = rawObj;
  return { ...rest, suggested_activities: suggested };
}

type GameResults = { summary?: string; strengths?: string[]; suggested_activities?: string[] };

// ── Double-ring spinner — mirrors web CSS double-ring animation ───────────────
function DoubleRingSpinner() {
  const rot1 = useSharedValue(0);
  const rot2 = useSharedValue(0);

  useEffect(() => {
    rot1.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1, false);
    rot2.value = withRepeat(withTiming(-360, { duration: 700, easing: Easing.linear }), -1, false);
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
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          borderRadius: 32, borderWidth: 4, borderColor: 'rgba(16,185,129,0.2)',
        }}
      />
      {/* Outer spinner */}
      <Animated.View
        style={[style1, {
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          borderRadius: 32, borderWidth: 4,
          borderColor: 'transparent', borderTopColor: '#10b981',
        }]}
      />
      {/* Inner spinner (reverse, faster) */}
      <Animated.View
        style={[style2, {
          position: 'absolute', top: 8, right: 8, bottom: 8, left: 8,
          borderRadius: 24, borderWidth: 4,
          borderColor: 'transparent', borderTopColor: '#2dd4bf',
        }]}
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
      style={[style, {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        borderRadius: 12,
        padding: 12,
      }]}
      className="bg-surface-input"
    >
      <GradientIconBox from={from} to={to} size={24} radius={8} diagonal>
        <Text className="text-xs font-bold text-white">{index + 1}</Text>
      </GradientIconBox>
      <Text className="flex-1 text-sm leading-relaxed text-slate-300">{rec}</Text>
    </Animated.View>
  );
}

export default function GrowthAreasGreatInsightsScreen() {
  const navigation = useNavigation<GrowthNavProp>();
  const route = useRoute<GrowthRouteProp>();
  const { activityId } = route.params as { activityId: string };
  const { activeChildId, isAuthenticated, isLoading: isLoadingAuth } = useAuth();

  const area = areaByUrlName(activityId ?? '');

  const [childName, setChildName] = useState('');
  const [recommendations, setRecommendations] = useState<string[] | null>(null);
  const [interactiveAnswers, setInteractiveAnswers] = useState<Record<string, unknown>>({});
  const [childGameResults, setChildGameResults] = useState<GameResults | null>(null);
  // loading → initial DB fetch | idle → no cached recs, waiting for button
  // generating → LLM running | ready → recs available | error → load failed
  const [status, setStatus] = useState('loading');

  const contentStyle = useSlideUpWhenReady(!isLoadingAuth && status !== 'loading');

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
        const areaDoc =
          allDocs.find((a) => a.area_id === area.id && a.status === 'in_progress') ??
          allDocs.find((a) => a.area_id === area.id);

        const ia = areaDoc?.interactive_answers ?? {};
        setInteractiveAnswers(ia);

        const childActivity = areaDoc?.child_activity;
        const rawGameResults = childActivity?.['results'];
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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, activeChildId, activityId, area, navigation]);

  const generateRecommendations = useCallback(async () => {
    if (!area || !activeChildId) return;
    setStatus('generating');

    const questions: Question[] = AREA_QUESTIONS[area.id] ?? [];
    const qaContext = questions
      .filter((q) => interactiveAnswers[q.id])
      .map(
        (q) =>
          `Q: ${q.question.replace(/\{name\}/g, childName || 'the child')}\nA: ${String(interactiveAnswers[q.id])}`,
      )
      .join('\n\n');

    const childContext = childGameResults
      ? `\n\nChild's activity responses:\nSummary: ${childGameResults.summary ?? ''}\nStrengths: ${(childGameResults.strengths ?? []).join(', ')}\nSuggested: ${(childGameResults.suggested_activities ?? []).join(', ')}`
      : '';

    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Based on the following parent responses about "${childName || 'the child'}" in the growth area "${area.name}", generate 5 practical 3-month recommendations.\n\nParent responses:\n${qaContext}${childContext}\n\nReturn ONLY a JSON object with a "recommendations" array of 5 short, actionable bullet points (1-2 sentences each) specific to the "${area.name}" growth area.`,
        response_json_schema: {
          type: 'object',
          properties: {
            recommendations: { type: 'array', items: { type: 'string' } },
          },
        },
      });

      const resultRecord = result as Record<string, unknown> | null;
      const list: string[] = Array.isArray(resultRecord?.['recommendations'])
        ? (resultRecord['recommendations'] as string[])
        : [];
      setRecommendations(list);

      await api.completedGrowthAreas.append(activeChildId, {
        area_id: area.id,
        area_name: area.name,
        area_color: area.color,
        answers: interactiveAnswers,
        status: 'completed',
        step: 'activity_summary',
        ai_three_month_recommendations: list,
        interactive_answers: interactiveAnswers,
      });

      setStatus('ready');
    } catch (err) {
      console.error('[GrowthAreasGreatInsightsScreen] LLM failed:', err);
      toast.error('Could not generate recommendations. Please try again.');
      setStatus('idle');
    }
  }, [area, activeChildId, childName, interactiveAnswers, childGameResults]);

  if (isLoadingAuth || status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#14b8a6" />
      </View>
    );
  }

  if (status === 'error' || !area) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-4">
        <Text className="text-slate-400">Could not load insights. Please try again.</Text>
        <Button
          onPress={() => navigation.navigate('GrowthAreas')}
          className="rounded-2xl px-8"
        >
          <Text className="text-white">Back to Growth Areas</Text>
        </Button>
      </View>
    );
  }

  const Icon = area.icon;
  const { from: gradFrom, to: gradTo } = areaGrad(area.color);

  // Q&A summary rows
  const questions: Question[] = AREA_QUESTIONS[area.id] ?? [];
  const answeredQuestions = questions.filter((q) => interactiveAnswers[q.id]);

  return (
    <Animated.View style={contentStyle} className="flex-1 bg-background">
      {/* Area header */}
      <View className="border-b border-white/10 bg-slate-900/90 px-4 py-3">
        <View className="flex-row items-center gap-3">
          <GradientIconBox from={gradFrom} to={gradTo} size={36} radius={12} diagonal>
            <Icon size={20} color="white" />
          </GradientIconBox>
          <Text className="text-sm font-semibold text-white">{area.name} — Great Insights</Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 32, paddingBottom: 40, gap: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header — gradient area icon + title */}
        <View className="items-center">
          <GradientIconBox from={gradFrom} to={gradTo} size={80} radius={20} diagonal>
            <Icon size={40} color="white" />
          </GradientIconBox>
          <Text className="mb-2 text-2xl font-bold text-white mt-4">Great Insights!</Text>
          <Text className="text-slate-400">
            Here's what we learned about {childName}'s {area.name}
          </Text>
        </View>

        <View className="gap-6">
          {/* Q&A summary */}
          {answeredQuestions.length > 0 && (
            <View
              className="gap-3 rounded-2xl bg-card p-6"
              style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
            >
              {answeredQuestions.map((q) => {
                const answerVal = interactiveAnswers[q.id];
                return (
                  <View
                    key={q.id}
                    className="border-b border-white/5 pb-3 last:border-0 last:pb-0"
                  >
                    <Text className="mb-1 text-xs text-slate-500">
                      {q.question.replace(/\{name\}/g, childName || 'your child')}
                    </Text>
                    <Text className="text-sm font-medium text-white">
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
              className="gap-4 rounded-2xl bg-card p-6"
              style={{ borderWidth: 1, borderColor: 'rgba(52,211,153,0.20)' }}
            >
              <View className="mb-2 flex-row items-center gap-2">
                {/* Always emerald→teal, mirrors web's from-emerald-500 to-teal-600 */}
                <GradientIconBox from="#10b981" to="#0d9488" size={40} radius={20} diagonal>
                  <Sparkles size={20} color="white" />
                </GradientIconBox>
                <Text className="font-bold text-white">Recommendations for {childName}</Text>
              </View>

              {childGameResults.summary ? (
                <View className="rounded-xl bg-surface-elevated p-4">
                  <Text className="mb-2 font-semibold text-white">What This Reveals</Text>
                  <Text className="text-sm text-slate-400">{childGameResults.summary}</Text>
                </View>
              ) : null}

              {Array.isArray(childGameResults.suggested_activities) &&
              childGameResults.suggested_activities.length > 0 ? (
                <View className="rounded-xl bg-surface-elevated p-4">
                  <Text className="mb-2 font-semibold text-white">Suggested Activities</Text>
                  <View className="gap-2">
                    {childGameResults.suggested_activities.map((act) => (
                      <View key={act} className="flex-row items-start gap-2">
                        <Text className="text-emerald-500">✓</Text>
                        <Text className="flex-1 text-sm text-slate-400">{act}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {Array.isArray(childGameResults.strengths) &&
              childGameResults.strengths.length > 0 ? (
                <View className="rounded-xl bg-surface-elevated p-4">
                  <Text className="mb-2 font-semibold text-white">Strengths to Encourage</Text>
                  <View className="gap-2">
                    {childGameResults.strengths.map((s) => (
                      <View key={s} className="flex-row items-start gap-2">
                        <Text className="text-emerald-500">★</Text>
                        <Text className="flex-1 text-sm text-slate-400">{s}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          )}

          {/* 3-month recommendations */}
          <View
            className="rounded-2xl bg-card p-6"
            style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
          >
            <View className="mb-4 flex-row items-center gap-2">
              <Target size={20} color="#10b981" />
              <Text className="font-semibold text-white">
                3-Month Recommendations for {area.name}
              </Text>
            </View>

            {/* Idle — generate button */}
            {status === 'idle' && (
              <GradientButton
                from="#10b981"
                to="#0d9488"
                height={44}
                borderRadius={16}
                onPress={() => { void generateRecommendations(); }}
                style={{ width: '100%' }}
              >
                <View className="flex-row items-center gap-2">
                  <Sparkles size={16} color="#0a0a0a" />
                  <Text className="font-semibold text-[#0a0a0a]">Generate Recommendations</Text>
                </View>
              </GradientButton>
            )}

            {/* Generating — double-ring spinner (mirrors web) */}
            {status === 'generating' && (
              <View className="items-center gap-5 py-10">
                <DoubleRingSpinner />
                <View className="items-center gap-1">
                  <Text className="text-sm font-semibold text-white">
                    Building your 3-Month Plan
                  </Text>
                  <Text className="text-xs text-slate-500">
                    Personalising recommendations for {childName}…
                  </Text>
                </View>
              </View>
            )}

            {/* Ready — staggered recommendation list */}
            {status === 'ready' &&
              Array.isArray(recommendations) &&
              recommendations.length > 0 && (
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
                <Text className="font-semibold text-[#0a0a0a]">Done</Text>
                <ChevronRight size={16} color="#0a0a0a" />
              </View>
            </GradientButton>

            <Button
              variant="outline"
              onPress={() => navigation.navigate('GrowthAreas')}
              className="h-12 w-full rounded-2xl px-6"
            >
              <View className="flex-row items-center gap-1.5">
                <ChevronLeft size={16} color="#cbd5e1" />
                <Text className="text-sm font-medium text-slate-300">Back</Text>
              </View>
            </Button>
          </View>
        </View>
      </ScrollView>
    </Animated.View>
  );
}
