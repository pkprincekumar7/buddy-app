import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EmojiText } from '@/components/ui/EmojiText';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import {
  Sparkles,
  Star,
  Compass,
  Zap,
  Clock,
  ChevronLeft,
} from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import { useFocusEntranceAnim } from '@/lib/animations';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { recommendationsJourneySchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft, determinePhase } from '@/lib/onboardingHelpers';
import { buildJourneyRecommendationsPrompt } from '@/lib/prompts';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import {
  GradientIconBox,
  GradientButton,
} from '@/components/shared/GradientView';
import { PERSONALITY_JOURNEY_GRADIENT } from '@/lib/gradientColors';
import type { RootStackParamList } from '@/navigation';

type PersonalityJourneyNavProp = StackNavigationProp<RootStackParamList>;
type PersonalityJourneyRouteProp = RouteProp<
  { PersonalityJourney: { childId?: string } | undefined },
  'PersonalityJourney'
>;

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

const PHASES = [
  { label: 'Getting to Know', icon: '💬', done: true, active: false },
  { label: 'Personality Analysis', icon: '⭐', done: true, active: false },
  { label: 'Your Journey', icon: '💡', done: false, active: true },
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
            <EmojiText size="sm">{phase.icon}</EmojiText>
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

// Staggered slide-in for each strength row (mirrors web motion.div delay: 1.1 + index * 0.25s)
function AnimatedStrengthItem({
  strength,
  index,
}: {
  strength: string;
  index: number;
}) {
  const { colors: strengthColors } = useTheme();
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-20);

  useEffect(() => {
    const delay = 1100 + index * 250;
    const cfg = { duration: 800, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    translateX.value = withDelay(delay, withTiming(0, cfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

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
          backgroundColor: strengthColors.muted,
        },
      ]}
    >
      <View
        className="h-7 w-7 flex-shrink-0 rounded-lg items-center justify-center"
        style={{ backgroundColor: strengthColors.warning + '26' }}
      >
        <Text
          style={{ color: strengthColors.warning }}
          className="text-xs font-bold"
        >
          {index + 1}
        </Text>
      </View>
      <Text
        style={{ color: strengthColors.text }}
        className="text-sm font-semibold flex-1"
      >
        {strength}
      </Text>
    </Animated.View>
  );
}

export default function PersonalityJourneyScreen() {
  const navigation = useNavigation<PersonalityJourneyNavProp>();
  const { colors } = useTheme();
  const route = useRoute<PersonalityJourneyRouteProp>();

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
  const [profile, setProfile] = useState<ProfileType>(null);
  const [childName, setChildName] = useState('');
  const [status, setStatus] = useState<
    'loading' | 'generating' | 'ready' | 'error'
  >('loading');

  const [showSplash, startTimer] = useStageSplash();

  const scrollRef = useRef<ScrollView>(null);
  // Reset scroll to top every time the screen gains focus (covers back navigation).
  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );

  // Section animations match web delays: header 100ms, profile 800ms, growth 1800ms.
  // useFocusEntranceAnim re-plays on back navigation for polish.
  const ready = status === 'ready' && !showSplash;
  const contentStyle = useFocusEntranceAnim(ready, 0, 1000);
  const headerAnim = useFocusEntranceAnim(ready, 100, 1000);
  const profileAnim = useFocusEntranceAnim(ready, 800, 1000);
  const growthAnim = useFocusEntranceAnim(ready, 1800, 1000);

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
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;

        if (!child) {
          navigation.navigate('Main');
          return;
        }

        const personality = child.personality;
        const viewModel = personality?.view_model;
        if (!viewModel?.type) {
          // Not analysed yet — go back to personality type screen
          (
            navigation as unknown as {
              navigate: (name: string, params?: unknown) => void;
            }
          ).navigate('PersonalityType', childId ? { childId } : undefined);
          return;
        }

        const merged = mergeChildDraft(
          normalizeOnboardingChildDataBlob(child) ?? {},
        );
        setChildName(merged.name || '');

        const gp = onboardingProfileFromViewModel(viewModel);
        setProfile(gp);

        // DB hit: recommendations already generated — skip LLM
        const recommendations = child.recommendations;
        if (
          recommendations &&
          (typeof recommendations['pathway_overview'] === 'string' ||
            (Array.isArray(recommendations['focus_areas']) &&
              (recommendations['focus_areas'] as unknown[]).length > 0))
        ) {
          setStatus('ready');
          return;
        }

        if (!merged.name?.trim()) {
          (
            navigation as unknown as {
              navigate: (name: string, params?: unknown) => void;
            }
          ).navigate('PersonalityType', childId ? { childId } : undefined);
          return;
        }

        setStatus('generating');
        const age = parseInt(String(merged.age), 10) || 10;
        const lifePhase = determinePhase(age);

        try {
          const result = await api.integrations.Core.InvokeLLM({
            prompt: buildJourneyRecommendationsPrompt({
              childData: merged,
              age,
              lifePhase,
              personalityType:
                gp?.personality_type ??
                `${viewModel?.type ?? 'Unknown'} (${
                  (viewModel?.profile?.['name'] as string) ?? ''
                })`,
              personalityNarrative: gp?.summary,
              growthAreas: gp?.growth_areas as string[] | undefined,
            }),
            response_json_schema: recommendationsJourneySchema(),
          });
          if (cancelled) return;

          if (result) {
            await api.entities.Child.update(childId, {
              recommendations: result,
              onboarding_phase: 3,
            });
          }
        } catch (err) {
          console.error('[PersonalityJourneyScreen] LLM failed:', err);
        }

        if (!cancelled) {
          setStatus('ready');
        }
      } catch (err) {
        console.warn('[PersonalityJourneyScreen] Load failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAuth, isAuthenticated, childId]);

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

  // — Generating state
  if (status === 'generating') {
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
          Mapping personalized recommendations…
        </Text>
      </View>
    );
  }

  // — Error state
  if (status === 'error') {
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
            (
              navigation as unknown as {
                navigate: (name: string, params?: unknown) => void;
              }
            ).navigate(
              'PersonalityType',
              childId ? { childId, fromBack: true } : { fromBack: true },
            )
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
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 24,
            paddingBottom: 40,
          }}
        >
          {/* Header — mirrors web: gradient rounded-3xl box + Sparkles icon */}
          <Animated.View style={headerAnim} className="items-center mb-6">
            <GradientIconBox
              from={colors.primaryLight}
              to={colors.primary}
              size={96}
              radius={24}
              diagonal
            >
              <Sparkles size={48} color={colors.primaryForeground} />
            </GradientIconBox>
            <Text
              style={{ color: colors.text }}
              className="text-xl font-bold text-center mb-2 mt-5"
            >
              Your Personalized Journey
            </Text>
            <Text
              style={{ color: colors.textMuted }}
              className="text-sm text-center"
            >
              Here's what we've discovered about {childName}
            </Text>
          </Animated.View>

          {/* Profile summary — mirrors web: border-edge + gradient star icon + surface-input strengths */}
          {profile && (
            <Animated.View
              style={[
                profileAnim,
                {
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                },
              ]}
              className="rounded-2xl p-6 mb-5"
            >
              <View className="flex-row items-start gap-4 mb-4">
                <GradientIconBox
                  from={colors.primaryLight}
                  to={colors.primary}
                  size={48}
                  radius={12}
                  diagonal
                >
                  <Star size={24} color={colors.primaryForeground} />
                </GradientIconBox>
                <View className="flex-1">
                  <Text
                    style={{ color: colors.text }}
                    className="text-lg font-bold"
                  >
                    {childName}'s Profile
                  </Text>
                  <Text
                    style={{ color: colors.primary }}
                    className="text-sm font-medium"
                  >
                    {profile.personality_type?.split(' - ')[1] ??
                      profile.personality_type}
                  </Text>
                </View>
              </View>

              <Text
                style={{ color: colors.textMuted }}
                className="text-sm leading-relaxed mb-5"
              >
                {profile.summary}
              </Text>

              <Text
                style={{ color: colors.iconColor }}
                className="text-xs font-semibold uppercase tracking-widest mb-3"
              >
                Emerging Strengths
              </Text>
              <View className="gap-2">
                {(profile.top_strengths as string[])?.map((strength, index) => (
                  <AnimatedStrengthItem
                    key={String(strength)}
                    strength={String(strength)}
                    index={index}
                  />
                ))}
              </View>
            </Animated.View>
          )}

          {/* Growth areas prompt — mirrors web: gradient compass icon + gradient Continue + Clock Later */}
          <Animated.View
            style={[growthAnim, { backgroundColor: colors.card }]}
            className="rounded-2xl border border-purple-500/20 p-6 mb-5"
          >
            <View className="items-center gap-4">
              <GradientIconBox
                from={PERSONALITY_JOURNEY_GRADIENT.from}
                to={PERSONALITY_JOURNEY_GRADIENT.to}
                size={56}
                radius={16}
                diagonal
              >
                <Compass size={28} color={colors.primaryForeground} />
              </GradientIconBox>
              <Text
                style={{ color: colors.text }}
                className="text-base font-bold text-center"
              >
                Do you want to explore the specific growth areas for {childName}{' '}
                to become their best version?
              </Text>
              <Text
                style={{ color: colors.textMuted }}
                className="text-sm text-center"
              >
                Discover personalized activities to help {childName} develop key
                life skills
              </Text>
              <View className="w-full gap-3 pt-1">
                <GradientButton
                  from={PERSONALITY_JOURNEY_GRADIENT.from}
                  to={PERSONALITY_JOURNEY_GRADIENT.to}
                  height={48}
                  borderRadius={16}
                  onPress={() =>
                    (
                      navigation as unknown as {
                        navigate: (name: string, params?: unknown) => void;
                      }
                    ).navigate('Growth', childId ? { childId } : undefined)
                  }
                  style={{ width: '100%' }}
                >
                  <View className="flex-row items-center gap-2">
                    <Zap size={16} color={colors.primaryForeground} />
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: colors.primaryForeground }}
                    >
                      Continue Now
                    </Text>
                  </View>
                </GradientButton>
                <Button
                  size="xl"
                  variant="outline"
                  onPress={() => navigation.navigate('Main')}
                  className="rounded-2xl"
                >
                  <View className="flex-row items-center gap-2">
                    <Clock size={16} color={colors.textMuted} />
                    <Text
                      style={{ color: colors.textMuted }}
                      className="text-base"
                    >
                      Catch Up Later
                    </Text>
                  </View>
                </Button>
              </View>
            </View>
          </Animated.View>

          {/* Back navigation + Start Over */}
          <PageActions
            className="mt-2"
            left={
              <Button
                variant="outline"
                onPress={() =>
                  (
                    navigation as unknown as {
                      navigate: (name: string, params?: unknown) => void;
                    }
                  ).navigate(
                    'PersonalityType',
                    childId ? { childId, fromBack: true } : { fromBack: true },
                  )
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
          />
        </ScrollView>
      </Animated.View>

      {showSplash && <StageSplash stage={4} onReady={startTimer} />}
    </View>
  );
}
