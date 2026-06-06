import React, { useEffect, useState } from 'react';
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
  calculateMBTI,
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
  const [childName, setChildName] = useState('');
  const [mbtiResult, setMbtiResult] = useState<MbtiResult | null>(null);
  const [status, setStatus] = useState<
    'loading' | 'analysing' | 'ready' | 'error'
  >('loading');
  const [ttsEnabled, setTtsEnabled] = useState(true);

  const [showSplash, startTimer] = useStageSplash();
  // Animate in only after data is ready AND stage-2 splash is gone — mirrors web PersonalityType.tsx.
  const contentStyle = useSlideUpWhenReady(status === 'ready' && !showSplash);

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

        const merged = mergeChildDraft(
          normalizeOnboardingChildDataBlob(child) ?? {},
        );
        setChildName(merged.name || '');

        // DB hit: personality already analysed — skip LLM
        const personality = child.personality;
        const viewModel = personality?.view_model;
        if (viewModel?.type && viewModel?.profile) {
          const clamped = maybeClampStoredPersonalityDescription(viewModel, {
            analysisSource: personality?.source,
          });
          setMbtiResult(
            sanitizeViewModelAvatars(clamped) as unknown as MbtiResult,
          );
          setStatus('ready');
          return;
        }

        if (!merged.name?.trim()) {
          // No name — can't analyse; fall back to root
          navigation.navigate('Main');
          return;
        }

        // Call LLM
        setStatus('analysing');
        const childId_ = child.id;
        try {
          const prompt = buildPersonalityAnalysisPrompt({
            childData: merged,
            personalityTypeKeys: PERSONALITY_TYPE_KEYS,
          });
          const ai = await api.integrations.Core.InvokeLLM({
            prompt,
            response_json_schema: personalityLlmSchema(),
          });
          if (cancelled) return;

          const vm = adaptAiPersonalityToViewModel(
            (ai as Record<string, unknown>) || {},
            merged.name,
          );
          await api.entities.Child.update(childId_, {
            personality: {
              source: 'llm',
              view_model: stripViewModelImages(vm),
            },
            onboarding_phase: 2,
          });
          if (cancelled) return;
          setMbtiResult(vm as unknown as MbtiResult);
        } catch (err) {
          console.warn(
            '[PersonalityTypeScreen] LLM failed, falling back to rule-based:',
            err,
          );
          const ruleVm = calculateMBTI(merged);
          try {
            await api.entities.Child.update(childId_, {
              personality: {
                source: 'rule_fallback',
                view_model: stripViewModelImages(ruleVm),
              },
              onboarding_phase: 2,
            });
          } catch {
            /* non-fatal */
          }
          if (cancelled) return;
          setMbtiResult(ruleVm as unknown as MbtiResult);
        }
        if (!cancelled) {
          setStatus('ready');
        }
      } catch (err) {
        console.warn('[PersonalityTypeScreen] Load failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
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
  if (isLoadingAuth || status === 'loading') {
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
  if (status === 'analysing') {
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
  if (status === 'error' || !mbtiResult) {
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
