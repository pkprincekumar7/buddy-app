import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import { Brain, Star, Sprout, Compass, Check } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import {
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
  type MbtiResult,
} from '@/lib/personalityLogic';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import {
  sanitizeViewModelAvatars,
  stripViewModelImages,
} from '@/lib/avatarUtils';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';
import type { RootStackParamList } from '@/navigation';
import { useJob } from '@/hooks/useJob';

type PersonalityTypeNavProp = StackNavigationProp<RootStackParamList>;
type PersonalityTypeRouteProp = RouteProp<
  { PersonalityType: { childId?: string } | undefined },
  'PersonalityType'
>;

// ── Analysis checklist steps — mirrors web PersonalityType.tsx ────────────────

type LucideIcon = typeof Brain;

interface AnalysisStep {
  label: string;
  Icon: LucideIcon;
  heading: (name: string) => string;
  subtitle: string;
  iconColor: string;
  iconBg: string;
}

function useAnalysisSteps() {
  const { colors } = useTheme();
  const steps: AnalysisStep[] = [
    {
      label: 'Reading personality traits',
      Icon: Brain,
      heading: (name: string) => `Reading ${name}'s personality traits...`,
      subtitle: 'Looking at how your child thinks, feels and responds.',
      iconColor: colors.primary,
      iconBg: colors.primarySubtle,
    },
    {
      label: 'Mapping strengths & interests',
      Icon: Star,
      heading: () => 'Mapping strengths & interests...',
      subtitle:
        "Connecting the dots between what they love and what they're great at.",
      iconColor: colors.warning,
      iconBg: colors.successSubtle,
    },
    {
      label: 'Building growth profile',
      Icon: Sprout,
      heading: () => 'Building the growth profile...',
      subtitle: 'Shaping a personal plan rooted in their unique strengths.',
      iconColor: colors.primary,
      iconBg: colors.primarySubtle,
    },
    {
      label: 'Finalizing personalized journey',
      Icon: Compass,
      heading: () => 'Finalizing the personalized journey...',
      subtitle: 'Almost there — preparing recommendations made just for them.',
      iconColor: colors.personality,
      iconBg: colors.primaryMuted,
    },
  ];
  return steps;
}

// ── Phase bar (numbered stepper — mirrors web OnboardingProgressHeader) ────────

const PHASES = [
  { num: 1, label: 'Getting to Know', done: true, active: false },
  { num: 2, label: 'Personality Analysis', done: false, active: true },
  { num: 3, label: 'Your Journey', done: false, active: false },
];

function PhaseBar() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        {PHASES.map((phase, i, arr) => {
          const isLast = i === arr.length - 1;
          return (
            <View
              key={phase.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                ...(isLast
                  ? { flexGrow: 0, flexShrink: 0 }
                  : { flex: phase.active ? 2 : 1 }),
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  ...(phase.done
                    ? { backgroundColor: colors.success }
                    : phase.active
                    ? { backgroundColor: colors.primary }
                    : {
                        backgroundColor: colors.surfaceElevated,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }),
                }}
              >
                {phase.done ? (
                  <Check size={13} color="#fff" />
                ) : (
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: phase.active
                        ? colors.primaryForeground
                        : colors.textMuted,
                      opacity: phase.active ? 1 : 0.4,
                    }}
                  >
                    {phase.num}
                  </Text>
                )}
              </View>
              {phase.active && (
                <Text
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    fontWeight: '500',
                    color: colors.text,
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {phase.label}
                </Text>
              )}
              {!isLast && (
                <View
                  style={{
                    flex: 1,
                    height: 2,
                    marginHorizontal: 12,
                    minWidth: 24,
                    borderRadius: 1,
                    backgroundColor: colors.border,
                    overflow: 'hidden',
                  }}
                >
                  {phase.done && (
                    <View
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundColor: colors.success,
                      }}
                    />
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Animated checklist item ───────────────────────────────────────────────────

function ChecklistItem({
  step,
  isDone,
  isActive,
  delay,
}: {
  step: AnalysisStep;
  isDone: boolean;
  isActive: boolean;
  delay: number;
}) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-16);

  useEffect(() => {
    const t = setTimeout(() => {
      opacity.value = withTiming(1, { duration: 400 });
      translateX.value = withTiming(0, { duration: 400 });
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  const checkScale = useSharedValue(0);
  useEffect(() => {
    if (isDone) checkScale.value = withSpring(1, { stiffness: 200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone]);
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const { Icon } = step;

  return (
    <Animated.View
      style={[
        style,
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          borderRadius: 12,
          borderWidth: 1,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderColor: isDone
            ? colors.primaryBorder
            : isActive
            ? colors.primaryMuted
            : colors.border,
          backgroundColor: isDone
            ? colors.primarySubtle
            : isActive
            ? colors.surfaceElevated
            : 'transparent',
          opacity: !isDone && !isActive ? 0.4 : 1,
        },
      ]}
    >
      <Icon
        size={16}
        color={
          isDone ? colors.primary : isActive ? colors.text : colors.textMuted
        }
      />
      <Text
        className="flex-1 text-sm font-medium"
        style={{
          color: isDone
            ? colors.primary
            : isActive
            ? colors.text
            : colors.textMuted,
        }}
      >
        {step.label}
        {isActive ? '...' : ''}
      </Text>
      {isDone && (
        <Animated.View style={checkStyle}>
          <Check size={14} color={colors.primary} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ── Animated icon (swaps on step change) ─────────────────────────────────────

function ActiveStepIcon({
  step,
  stepIndex,
}: {
  step: AnalysisStep;
  stepIndex: number;
}) {
  const scale = useSharedValue(0.7);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1, { stiffness: 200, damping: 18 });
    opacity.value = withTiming(1, { duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const { Icon } = step;

  return (
    <Animated.View
      style={[
        style,
        {
          height: 80,
          width: 80,
          borderRadius: 40,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: step.iconBg,
          borderWidth: 4,
          borderColor: step.iconColor + '33',
        },
      ]}
    >
      <Icon size={40} color={step.iconColor} />
    </Animated.View>
  );
}

// ── Analysis loading screen ───────────────────────────────────────────────────

function AnalysisLoadingScreen({
  childName,
  completedSteps,
  progressPct,
  steps,
}: {
  childName: string;
  completedSteps: number;
  progressPct: number;
  steps: AnalysisStep[];
}) {
  const { colors } = useTheme();
  const activeIdx = Math.min(completedSteps, steps.length - 1);
  const activeStep = steps[activeIdx] ?? steps[0]!;
  const stepNum = Math.min(completedSteps + 1, steps.length);

  const progressWidth = useSharedValue(0);
  useEffect(() => {
    progressWidth.value = withTiming(progressPct, { duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressPct]);
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PhaseBar />
      <View
        className="flex-1 items-center justify-center px-4"
        style={{ gap: 20, paddingBottom: 24 }}
      >
        <Text
          className="text-[11px] font-semibold uppercase"
          style={{ letterSpacing: 2.5, color: colors.textMuted, opacity: 0.6 }}
        >
          Personality Analysis · Step {stepNum} / {steps.length}
        </Text>

        <View
          style={{
            width: '100%',
            maxWidth: 360,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: 24,
            alignItems: 'center',
            gap: 20,
          }}
        >
          {/* Animated icon */}
          <ActiveStepIcon step={activeStep} stepIndex={activeIdx} />

          {/* Heading + subtitle */}
          <View className="items-center" style={{ gap: 4 }}>
            <Text
              className="text-xl font-bold text-center"
              style={{ color: colors.text }}
            >
              {activeStep.heading(childName || 'your child')}
            </Text>
            <Text
              className="text-sm text-center"
              style={{ color: colors.textMuted }}
            >
              {activeStep.subtitle}
            </Text>
          </View>

          {/* Progress bar */}
          <View style={{ width: '100%', gap: 4 }}>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.surfaceDark,
                overflow: 'hidden',
                width: '100%',
              }}
            >
              <Animated.View
                style={[
                  progressStyle,
                  {
                    height: '100%',
                    borderRadius: 4,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
            <Text
              className="text-xs font-semibold text-center"
              style={{ color: colors.textMuted }}
            >
              {progressPct}%
            </Text>
          </View>

          {/* Checklist */}
          <View style={{ width: '100%', gap: 8 }}>
            {steps.map((s, idx) => (
              <ChecklistItem
                key={s.label}
                step={s}
                isDone={idx < completedSteps}
                isActive={idx === completedSteps}
                delay={400 + idx * 120}
              />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PersonalityTypeScreen() {
  const navigation = useNavigation<PersonalityTypeNavProp>();
  const { colors } = useTheme();
  const route = useRoute<PersonalityTypeRouteProp>();

  const {
    isAuthenticated,
    isLoading: isLoadingAuth,
    activeChildId,
  } = useAuth();
  const routeChildId = (route.params as { childId?: string } | undefined)
    ?.childId;
  const childId = routeChildId ?? activeChildId;

  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [childName, setChildName] = useState('');
  const [mbtiResult, setMbtiResult] = useState<MbtiResult | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [navigatingAway, setNavigatingAway] = useState(false);
  const mergedDataRef = useRef<Record<string, unknown> | null>(null);

  const steps = useAnalysisSteps();

  const finalizePersonality = useCallback(async () => {
    if (!childId) return;
    try {
      const child = await api.entities.Child.get(childId);
      const personality = child?.personality;
      const pendingVm = (child?.pending_personality_vm ??
        personality?.pending_view_model) as Record<string, unknown> | undefined;
      const merged = mergedDataRef.current;

      if (pendingVm && merged) {
        const vm = adaptAiPersonalityToViewModel(
          pendingVm,
          merged.name as string,
        );
        setMbtiResult(sanitizeViewModelAvatars(vm) as unknown as MbtiResult);
        api.entities.Child.update(childId, {
          personality: { source: 'llm', view_model: stripViewModelImages(vm) },
          onboarding_phase: 2,
        }).catch(err =>
          console.error(
            '[PersonalityType] Failed to persist personality:',
            err,
          ),
        );
      } else if (
        personality?.view_model?.type &&
        personality?.view_model?.profile
      ) {
        const clamped = maybeClampStoredPersonalityDescription(
          personality.view_model,
          { analysisSource: personality?.source },
        );
        setMbtiResult(
          sanitizeViewModelAvatars(clamped) as unknown as MbtiResult,
        );
      }
    } catch (err) {
      console.error('[PersonalityType] Failed to finalize personality:', err);
    }
  }, [childId]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_personality_analysis',
    onCompleted: finalizePersonality,
  });

  const isAnalysing = !isInitializing && job.isLoading;
  const isError = initError || job.isFailed;

  // Advance checklist steps as job progresses (mirrors web PersonalityType.tsx)
  useEffect(() => {
    if (!isAnalysing || mbtiResult) return;
    const progress = Math.min((job.elapsedMs / 1000 / 30) * 100, 95);
    const s =
      progress < 25
        ? 0
        : progress < 50
        ? 1
        : progress < 75
        ? 2
        : progress < 95
        ? 3
        : 4;
    setCompletedSteps(s);
    setProgressPct(Math.round(progress));
  }, [isAnalysing, job.elapsedMs, mbtiResult]);

  // When analysis done: animate remaining steps then auto-navigate to PersonalityJourney
  useEffect(() => {
    if (!mbtiResult || navigatingAway) return;
    if (completedSteps < steps.length) {
      const next = completedSteps + 1;
      const t = setTimeout(() => {
        setCompletedSteps(next);
        setProgressPct(Math.round((next / steps.length) * 100));
      }, 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setNavigatingAway(true);
      (
        navigation as unknown as {
          navigate: (name: string, params?: unknown) => void;
        }
      ).navigate('PersonalityJourney', childId ? { childId } : undefined);
    }, 1200);
    return () => clearTimeout(t);
  }, [
    mbtiResult,
    completedSteps,
    navigatingAway,
    childId,
    navigation,
    steps.length,
  ]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      // React Navigation automatically switches to the Auth stack when the user
      // is no longer authenticated — no explicit navigate needed.
      return;
    }
    if (!childId) {
      navigation.navigate('Main');
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;

        if (!child) {
          navigation.navigate('Main');
          return;
        }

        const merged = mergeChildDraft(
          normalizeOnboardingChildDataBlob(child) ?? {},
        );
        mergedDataRef.current = merged as Record<string, unknown>;
        setChildName(merged.name || '');
        setChildData(child as Record<string, unknown>);

        const personality = child.personality;
        const viewModel = personality?.view_model;
        if (viewModel?.type && viewModel?.profile) {
          const clamped = maybeClampStoredPersonalityDescription(viewModel, {
            analysisSource: personality?.source,
          });
          setMbtiResult(
            sanitizeViewModelAvatars(clamped) as unknown as MbtiResult,
          );
          setIsInitializing(false);
          return;
        }

        const pendingVm = (child.pending_personality_vm ??
          personality?.pending_view_model) as
          | Record<string, unknown>
          | undefined;
        if (pendingVm) {
          const vm = adaptAiPersonalityToViewModel(
            pendingVm,
            merged.name as string,
          );
          if (cancelled) return;
          setMbtiResult(sanitizeViewModelAvatars(vm) as unknown as MbtiResult);
          setIsInitializing(false);
          api.entities.Child.update(childId, {
            personality: {
              source: 'llm',
              view_model: stripViewModelImages(vm),
            },
            onboarding_phase: 2,
          }).catch(console.error);
          return;
        }

        if (!merged.name?.trim()) {
          navigation.navigate('Main');
          return;
        }

        const activeJobId = (
          child.active_jobs as Record<string, string> | undefined
        )?.generate_personality_analysis;
        if (!activeJobId) {
          await job.enqueue({
            type: 'generate_personality_analysis',
            child_id: childId,
            payload: {
              prompt: buildPersonalityAnalysisPrompt({
                childData: merged,
                personalityTypeKeys: PERSONALITY_TYPE_KEYS,
              }),
              response_json_schema: personalityLlmSchema(),
            },
            write_back: {
              collection: 'children',
              filter: {},
              field: 'pending_personality_vm',
            },
          });
        }
        setCompletedSteps(1);
        setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityType] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAuth, isAuthenticated, childId]);

  // — Loading state
  if (isLoadingAuth || isInitializing) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        className="items-center justify-center"
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // — Error state
  if (isError) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        className="flex-col items-center justify-center gap-4 px-4"
      >
        <Text style={{ color: colors.textMuted }} className="text-center mb-4">
          Something went wrong. Please try again.
        </Text>
        <Button
          onPress={() =>
            navigation.navigate('Onboarding', {
              screen: 'ConversationalOnboarding',
              params: { fromBack: true },
            } as never)
          }
          className="rounded-2xl px-8"
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: colors.primaryForeground,
            }}
          >
            Go Back
          </Text>
        </Button>
      </View>
    );
  }

  // — Analysing state: animated checklist (mirrors web AnalysisLoadingScreen)
  if (isAnalysing || (mbtiResult && completedSteps < steps.length)) {
    return (
      <AnalysisLoadingScreen
        childName={childName}
        completedSteps={completedSteps}
        progressPct={progressPct}
        steps={steps}
      />
    );
  }

  // — Navigating away: keep checklist visible while transition happens
  return (
    <AnalysisLoadingScreen
      childName={childName}
      completedSteps={steps.length}
      progressPct={100}
      steps={steps}
    />
  );
}
