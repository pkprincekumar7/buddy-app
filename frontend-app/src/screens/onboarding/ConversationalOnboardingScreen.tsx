import { useEffect, useState, useCallback } from 'react';
import { EmojiText } from '@/components/ui/EmojiText';
import { View, Text, ActivityIndicator } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { OnboardingStackParamList } from '@/navigation';
import { navigateTo } from '@/lib/navigationRef';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import ConversationalOnboardingChat from '@/components/onboarding/ConversationalOnboarding';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';

type ConversationalOnboardingNavigationProp = StackNavigationProp<
  OnboardingStackParamList,
  'ConversationalOnboarding'
>;
type ConversationalOnboardingRouteProp = RouteProp<
  OnboardingStackParamList,
  'ConversationalOnboarding'
>;

export default function ConversationalOnboardingScreen() {
  const navigation = useNavigation<ConversationalOnboardingNavigationProp>();
  const _route = useRoute<ConversationalOnboardingRouteProp>();
  const { colors } = useTheme();
  const { activeChildId: childId } = useAuth();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [hasPersonality, setHasPersonality] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // bootKey is a static mount key for the chat component; held as a constant since it never changes.
  const bootKey = 0;

  const pageOpacity = useSharedValue(1);
  const pageStyle = useAnimatedStyle(() => ({ opacity: pageOpacity.value }));

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      navigation.navigate('Onboarding');
      return;
    }
    if (!childId) {
      navigation.goBack();
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;

        if (!child) {
          navigation.goBack();
          return;
        }

        // Preload existing data — no auto-redirect forward even if personality is ready.
        const viewModel = (child as Record<string, unknown>).personality as
          | Record<string, unknown>
          | undefined;
        const vm = viewModel?.view_model as Record<string, unknown> | undefined;
        const personalityReady = !!(vm?.type && vm?.profile);
        setHasPersonality(personalityReady);
        const normalized = normalizeOnboardingChildDataBlob(child);
        if (normalized) setChildData(mergeChildDraft(normalized));
      } catch (err) {
        console.warn('[ConversationalOnboarding] Hydration failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, childId, navigation]);

  const handleComplete = useCallback(
    async (conversationData: Record<string, unknown>) => {
      const mergedDraft = mergeChildDraft({
        ...(childData ?? {}),
        ...conversationData,
      });
      try {
        if (childId) {
          await api.entities.Child.update(childId, {
            ...mergedDraft,
            onboarding_phase: 2,
            onboarding_completed: false,
            ...(!hasPersonality && {
              personality: null,
              recommendations: null,
            }),
          });
        }
      } catch (err) {
        console.warn(
          '[ConversationalOnboarding] Could not save chatbot data:',
          err,
        );
      }
      // Navigate into the Personality tab's PersonalityType screen so the
      // full onboarding flow mirrors the web (Chat → Personality Analysis → Journey).
      navigateTo('Main', {
        screen: 'Personality',
        params: {
          screen: 'PersonalityType',
          params: childId ? { childId } : undefined,
        },
      });
    },
    [childData, childId, hasPersonality],
  );

  return (
    // Outer wrapper holds both the page and the absolute-positioned splash overlay
    <View style={{ flex: 1 }}>
      {/* Page content — opacity 0 while splash shows, fades to 1 when splash is done.
          Page content wrapper */}
      <Animated.View style={[{ flex: 1 }, pageStyle]}>
        {isLoading || !hydrated ? (
          <View
            className="flex-1 items-center justify-center"
            style={{ backgroundColor: colors.background }}
          >
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <View
            className="flex-1"
            style={{ backgroundColor: colors.background }}
          >
            {/* Progress indicator — fixed at top */}
            <View
              className="border-b px-4 py-3 z-40"
              style={{
                borderColor: colors.border,
                backgroundColor: colors.card,
              }}
            >
              <View className="flex-row items-center justify-between gap-2">
                {[
                  { label: 'Getting to Know', icon: '💬', active: true },
                  { label: 'Personality Analysis', icon: '⭐', active: false },
                  { label: 'Your Journey', icon: '💡', active: false },
                ].map(phase => (
                  <View
                    key={phase.label}
                    className={`flex-row items-center gap-2 rounded-xl px-3 py-2 flex-1 border ${
                      phase.active ? '' : 'opacity-50'
                    }`}
                    style={
                      phase.active
                        ? {
                            borderColor: colors.primary + '40',
                            backgroundColor: colors.primary + '1A',
                          }
                        : {
                            backgroundColor: colors.inactiveSurface,
                            borderColor: colors.border,
                          }
                    }
                  >
                    <EmojiText size="base">{phase.icon}</EmojiText>
                    <Text
                      className="text-xs font-medium flex-shrink-1"
                      style={{
                        color: phase.active ? colors.primary : colors.iconColor,
                      }}
                      numberOfLines={1}
                    >
                      {phase.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Chat — fills all remaining vertical space so its internal ScrollView
                is constrained and the "Continue" button stays pinned at the bottom.
                No outer ScrollView here: scrolling belongs only inside the chat. */}
            <View
              style={{
                flex: 1,
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: 8,
              }}
            >
              <ConversationalOnboardingChat
                key={bootKey}
                user={user}
                activeChildId={childId}
                resumeHydrationReady={hydrated}
                onComplete={handleComplete}
                onContinueToPersonality={() => {
                  void handleComplete({});
                }}
                onQuestionnairePersisted={slice =>
                  setChildData(prev =>
                    mergeChildDraft({ ...(prev ?? {}), ...slice }),
                  )
                }
                onQuestionnaireCleared={() => setChildData(null)}
              />
            </View>

            {/* Back + Start Over — fixed at the bottom, never scrolls */}
            <View
              className="px-4 pb-6 pt-3 border-t"
              style={{ borderColor: colors.border }}
            >
              <PageActions
                left={
                  <Button
                    size="xl"
                    variant="outline"
                    onPress={() =>
                      navigation.navigate('Onboarding', { fromBack: true })
                    }
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
                }
                center={
                  <StartOverButton
                    childId={childId ?? undefined}
                    className="w-full"
                  />
                }
              />
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}
