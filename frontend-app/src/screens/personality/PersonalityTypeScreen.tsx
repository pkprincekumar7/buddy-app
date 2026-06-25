import React, { useEffect, useState, useCallback, useRef } from 'react';
import { EmojiText } from '@/components/ui/EmojiText';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import { useSlideUpWhenReady } from '@/lib/animations';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import {
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
  type MbtiResult,
} from '@/lib/personalityLogic';
import PersonalityAnalysis from '@/components/shared/PersonalityAnalysis';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
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

// The PersonalityType screen lives in the Personality stack which is inside the Main tab.
// We use a generic navigation prop here so it can go to sibling screens and back to Main root.
type PersonalityTypeNavProp = StackNavigationProp<RootStackParamList>;

// Route carries optional childId param (passed by previous screens).
type PersonalityTypeRouteProp = RouteProp<
  { PersonalityType: { childId?: string } | undefined },
  'PersonalityType'
>;

const PHASES = [
  { label: 'Getting to Know', icon: '💬', done: true, active: false },
  { label: 'Personality Analysis', icon: '⭐', done: false, active: true },
  { label: 'Your Journey', icon: '💡', done: false, active: false },
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
      className="px-4 py-3"
    >
      <View className="flex-row items-center justify-between gap-2">
        {PHASES.map(phase => (
          <View
            key={phase.label}
            className="flex-row items-center gap-1.5 rounded-xl px-2.5 py-2 flex-1 border"
            style={{
              borderColor: phase.active
                ? colors.primary + '40'
                : phase.done
                ? colors.success + '33'
                : colors.border,
              backgroundColor: phase.active
                ? colors.primary + '1A'
                : phase.done
                ? colors.success + '1A'
                : 'transparent',
              opacity: !phase.active && !phase.done ? 0.5 : 1,
            }}
          >
            <EmojiText size="base">{phase.icon}</EmojiText>
            <Text
              style={{
                color: phase.active
                  ? colors.primary
                  : phase.done
                  ? colors.success
                  : colors.iconColor,
              }}
              className="text-xs font-medium flex-1"
              numberOfLines={1}
            >
              {phase.label}
            </Text>
            {phase.done && (
              <Text style={{ color: colors.success }} className="text-xs">
                ✓
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

export default function PersonalityTypeScreen() {
  const navigation = useNavigation<PersonalityTypeNavProp>();
  const { colors } = useTheme();
  const route = useRoute<PersonalityTypeRouteProp>();

  // Prefer explicit childId from navigation params (onboarding flow);
  // fall back to the auth context's active child (Personality tab access).
  const {
    isAuthenticated,
    isLoading: isLoadingAuth,
    activeChildId,
  } = useAuth();
  const routeChildId = (route.params as { childId?: string } | undefined)
    ?.childId;
  const childId = routeChildId ?? activeChildId;
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [childName, setChildName] = useState('');
  const [mbtiResult, setMbtiResult] = useState<MbtiResult | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  // Stores merged child data for the onCompleted callback without re-render dependencies.
  const mergedDataRef = useRef<Record<string, unknown> | null>(null);

  const [showSplash, startTimer] = useStageSplash();

  const finalizePersonality = useCallback(async () => {
    if (!childId) return;
    try {
      const child = await api.entities.Child.get(childId);
      const personality = child?.personality;
      const pendingVm = (child?.pending_personality_vm ?? personality?.pending_view_model) as Record<string, unknown> | undefined;
      const merged = mergedDataRef.current;

      if (pendingVm && merged) {
        const vm = adaptAiPersonalityToViewModel(pendingVm, merged.name as string);
        // Show result immediately — don't block on the save.
        setMbtiResult(sanitizeViewModelAvatars(vm) as unknown as MbtiResult);
        // Strip SVG data-URI images before saving — WAF blocks payloads containing
        // <svg>/<text> tags. sanitizeViewModelAvatars regenerates them on next load.
        api.entities.Child.update(childId, {
          personality: { source: 'llm', view_model: stripViewModelImages(vm) },
          onboarding_phase: 2,
        }).catch((err) => console.error('[PersonalityTypeScreen] Failed to persist personality:', err));
      } else if (personality?.view_model?.type && personality?.view_model?.profile) {
        const clamped = maybeClampStoredPersonalityDescription(personality.view_model, {
          analysisSource: personality?.source,
        });
        setMbtiResult(sanitizeViewModelAvatars(clamped) as unknown as MbtiResult);
      }
    } catch (err) {
      console.error('[PersonalityTypeScreen] Failed to finalize personality:', err);
    }
  }, [childId]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_personality_analysis',
    onCompleted: finalizePersonality,
  });

  const isAnalysing = !isInitializing && job.isLoading;
  const isError = initError || job.isFailed;
  const isReady = !isInitializing && !isAnalysing && !isError && mbtiResult !== null;
  // Animate in only after data is ready AND stage-2 splash is gone — mirrors web PersonalityType.tsx.
  const contentStyle = useSlideUpWhenReady(isReady && !showSplash);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigation.navigate('Onboarding');
      return;
    }
    if (!childId) {
      navigation.navigate('Main');
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const [child, prefs] = await Promise.all([
          api.entities.Child.get(childId),
          api.preferences.get().catch(() => null),
        ]);
        if (cancelled) return;

        if (!child) {
          navigation.navigate('Main');
          return;
        }

        if (prefs && typeof prefs.tts_enabled === 'boolean') {
          setTtsEnabled(prefs.tts_enabled);
        }

        const merged = mergeChildDraft(normalizeOnboardingChildDataBlob(child) ?? {});
        mergedDataRef.current = merged as Record<string, unknown>;
        setChildName(merged.name || '');
        setChildData(child as Record<string, unknown>);

        // Already analysed — show result immediately
        const personality = child.personality;
        const viewModel = personality?.view_model;
        if (viewModel?.type && viewModel?.profile) {
          const clamped = maybeClampStoredPersonalityDescription(viewModel, {
            analysisSource: personality?.source,
          });
          setMbtiResult(sanitizeViewModelAvatars(clamped) as unknown as MbtiResult);
          setIsInitializing(false);
          return;
        }

        // pending_personality_vm means worker succeeded but client crashed before finalizing
        const pendingVm = (child.pending_personality_vm ?? personality?.pending_view_model) as Record<string, unknown> | undefined;
        if (pendingVm) {
          const vm = adaptAiPersonalityToViewModel(pendingVm, merged.name as string);
          if (cancelled) return;
          setMbtiResult(sanitizeViewModelAvatars(vm) as unknown as MbtiResult);
          setIsInitializing(false);
          api.entities.Child.update(childId, {
            personality: { source: 'llm', view_model: stripViewModelImages(vm) },
            onboarding_phase: 2,
          }).catch((err) => console.error('[PersonalityTypeScreen] Failed to persist recovered personality:', err));
          return;
        }

        if (!merged.name?.trim()) {
          navigation.navigate('Main');
          return;
        }

        // Only enqueue if no active job is already polling (useJob picks it up via childData)
        const activeJobId = (child.active_jobs as Record<string, string> | undefined)
          ?.generate_personality_analysis;
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
            write_back: { collection: 'children', filter: {}, field: 'pending_personality_vm' },
          });
        }
        setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityTypeScreen] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => { cancelled = true; };
    // job.enqueue intentionally excluded — stable ref, adding it re-triggers the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAuth, isAuthenticated, childId]);

  const handleContinue = async () => {
    if (childId) {
      await api.entities.Child.update(childId, { onboarding_phase: 3 }).catch(
        () => {},
      );
    }
    // Navigate to PersonalityJourney — it is a sibling screen in the Personality stack.
    // We navigate within the stack by going back or using a named route. Use navigate on
    // the parent navigator by name. Here we push within the personality nested stack.
    (
      navigation as unknown as {
        navigate: (name: string, params?: unknown) => void;
      }
    ).navigate('PersonalityJourney', childId ? { childId } : undefined);
  };

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

  // — Analysing state
  if (isAnalysing) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        className="flex-col items-center justify-center gap-4 px-4"
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text
          style={{ color: colors.textMuted }}
          className="max-w-xs text-center font-medium mt-4"
        >
          Shaping personality insights from your questionnaire…
        </Text>
      </View>
    );
  }

  // — Error / no result state
  if (isError || !mbtiResult) {
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

  // — Ready state
  return (
    <View style={{ flex: 1 }}>
      <Animated.View
        style={[contentStyle, { backgroundColor: colors.background }]}
        className="flex-1"
      >
        <PhaseBar />

        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 24,
            paddingBottom: 40,
          }}
        >
          <PersonalityAnalysis
            mbtiResult={mbtiResult}
            childName={childName}
            ready={!showSplash}
            ttsEnabled={ttsEnabled}
          />

          {/* Navigation actions */}
          <PageActions
            className="mt-10"
            left={
              <Button
                variant="outline"
                onPress={() =>
                  navigation.navigate('Onboarding', {
                    screen: 'ConversationalOnboarding',
                    params: { fromBack: true },
                  } as never)
                }
                className="w-full rounded-2xl"
              >
                <View className="flex-row items-center gap-1.5">
                  <ChevronLeft size={16} color={colors.textMuted} />
                  <Text
                    style={{ color: colors.textMuted }}
                    className="text-base font-medium"
                  >
                    Back
                  </Text>
                </View>
              </Button>
            }
            center={
              <StartOverButton
                childId={childId ?? undefined}
                className="w-full"
              />
            }
            right={
              <Button
                size="xl"
                onPress={() => {
                  void handleContinue();
                }}
                className="w-full rounded-2xl"
              >
                <View className="flex-row items-center gap-1.5">
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '600',
                      color: colors.primaryForeground,
                    }}
                  >
                    Continue
                  </Text>
                  <ChevronRight size={16} color={colors.primaryForeground} />
                </View>
              </Button>
            }
          />
        </ScrollView>
      </Animated.View>

      {/* Stage-2 splash — mirrors web PersonalityType.tsx */}
      {showSplash && <StageSplash stage={2} onReady={startTimer} />}
    </View>
  );
}
