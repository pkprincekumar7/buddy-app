import { useEffect, useState, useCallback } from 'react';
import { EmojiText } from '@/components/ui/EmojiText';
import {
  View,
  Text,
  ActivityIndicator,
} from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { OnboardingStackParamList } from '@/navigation';
import { navigateTo } from '@/lib/navigationRef';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import ConversationalOnboardingChat from '@/components/onboarding/ConversationalOnboarding';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';

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
  const { activeChildId: childId } = useAuth();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [hasPersonality, setHasPersonality] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // bootKey is a static mount key for the chat component; held as a constant since it never changes.
  const bootKey = 0;

  // ── Splash + page fade-in (mirrors web's StageSplash + motion.div opacity) ──
  const [showSplash, startTimer] = useStageSplash();
  const pageOpacity = useSharedValue(showSplash ? 0 : 1);
  const pageStyle = useAnimatedStyle(() => ({ opacity: pageOpacity.value }));
  useEffect(() => {
    if (!showSplash) {
      pageOpacity.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) });
    }
  // pageOpacity is a stable ref — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSplash]);

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
      const mergedDraft = mergeChildDraft({ ...(childData ?? {}), ...conversationData });
      try {
        if (childId) {
          await api.entities.Child.update(childId, {
            ...mergedDraft,
            onboarding_phase: 2,
            onboarding_completed: false,
            ...(!hasPersonality && { personality: null, recommendations: null }),
          });
        }
      } catch (err) {
        console.warn('[ConversationalOnboarding] Could not save chatbot data:', err);
      }
      // Navigate into the Personality tab's PersonalityType screen so the
      // full onboarding flow mirrors the web (Chat → Personality Analysis → Journey).
      navigateTo('Main', {
        screen: 'Personality',
        params: { screen: 'PersonalityType', params: childId ? { childId } : undefined },
      });
    },
    [childData, childId, hasPersonality],
  );

  return (
    // Outer wrapper holds both the page and the absolute-positioned splash overlay
    <View style={{ flex: 1 }}>
      {/* Page content — opacity 0 while splash shows, fades to 1 when splash is done.
          Mirrors web: <motion.div initial={{ opacity:0 }} animate={{ opacity: showSplash ? 0 : 1 }}> */}
      <Animated.View style={[{ flex: 1 }, pageStyle]}>
        {isLoading || !hydrated ? (
          <View className="flex-1 items-center justify-center bg-background">
            <ActivityIndicator size="large" color="#14b8a6" />
          </View>
        ) : (
          <View className="flex-1 bg-background">
            {/* Progress indicator — fixed at top */}
            <View className="border-b border-slate-800 bg-slate-900/90 px-4 py-3 z-40">
              <View className="flex-row items-center justify-between gap-2">
                {[
                  { label: 'Getting to Know', icon: '💬', active: true },
                  { label: 'Personality Analysis', icon: '⭐', active: false },
                  { label: 'Your Journey', icon: '💡', active: false },
                ].map((phase) => (
                  <View
                    key={phase.label}
                    className={`flex-row items-center gap-2 rounded-xl px-3 py-2 flex-1 ${
                      phase.active ? 'border border-teal-500/25 bg-teal-500/10' : 'opacity-50'
                    }`}
                    style={
                      !phase.active
                        ? {
                            backgroundColor: 'rgba(255,255,255,0.04)',
                            borderWidth: 1,
                            borderColor: 'rgba(255,255,255,0.06)',
                          }
                        : undefined
                    }
                  >
                    <EmojiText size="base">{phase.icon}</EmojiText>
                    <Text
                      className={`text-xs font-medium flex-shrink-1 ${
                        phase.active ? 'text-teal-400' : 'text-slate-600'
                      }`}
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
            <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
              <ConversationalOnboardingChat
                key={bootKey}
                user={user}
                activeChildId={childId}
                resumeHydrationReady={hydrated && !showSplash}
                onComplete={handleComplete}
                onContinueToPersonality={() => { void handleComplete({}); }}
                onQuestionnairePersisted={(slice) =>
                  setChildData((prev) => mergeChildDraft({ ...(prev ?? {}), ...slice }))
                }
                onQuestionnaireCleared={() => setChildData(null)}
              />
            </View>

            {/* Back + Start Over — fixed at the bottom, never scrolls */}
            <View className="px-4 pb-6 pt-3 border-t border-slate-800">
              <PageActions
                left={
                  <Button
                    variant="outline"
                    onPress={() => navigation.navigate('Onboarding', { fromBack: true })}
                    className="h-12 w-full rounded-2xl px-6"
                  >
                    <View className="flex-row items-center gap-1.5">
                      <ChevronLeft size={16} color="#cbd5e1" />
                      <Text className="text-sm font-medium text-slate-300">Back</Text>
                    </View>
                  </Button>
                }
                center={<StartOverButton childId={childId ?? undefined} className="w-full" />}
              />
            </View>
          </View>
        )}
      </Animated.View>

      {/* Stage splash overlay — absolute, covers everything, fades out after 3 s.
          Mirrors web: <AnimatePresence>{showSplash && <StageSplash stage={2} … />}</AnimatePresence> */}
      {showSplash && <StageSplash stage={2} onReady={startTimer} />}
    </View>
  );
}
