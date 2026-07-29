import { useEffect, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '@/navigation';
import { navigateTo } from '@/lib/navigationRef';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import ConversationalOnboardingChat from '@/components/onboarding/ConversationalOnboarding';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';

// Deep navy background matching web's var(--bg-deep-3)
const DEEP_NAVY = '#080c18';

type ConversationalOnboardingNavProp = StackNavigationProp<
  OnboardingStackParamList,
  'ConversationalOnboarding'
>;

const TOTAL_CHAT_STEPS = 8;

export default function ConversationalOnboardingScreen() {
  const navigation = useNavigation<ConversationalOnboardingNavProp>();
  const { colors } = useTheme();
  const { activeChildId: childId } = useAuth();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [hasPersonality, setHasPersonality] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [chatStep, setChatStep] = useState(0);
  const bootKey = 0;

  // phase-1 fill: mirrors web's Math.round((displayStep / TOTAL_CHAT_STEPS) * 100)
  const phase1Progress = Math.min(
    100,
    Math.round(((chatStep + 1) / TOTAL_CHAT_STEPS) * 100),
  );

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      navigation.navigate('OnboardingWelcome');
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
            ...(!hasPersonality && { personality: null }),
          });
        }
      } catch (err) {
        console.warn(
          '[ConversationalOnboarding] Could not save chatbot data:',
          err,
        );
      }
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
    <View style={{ flex: 1, backgroundColor: DEEP_NAVY }}>
      {isLoading || !hydrated ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator size="large" color="#3c83f6" />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Progress bar — numbered stepper matching web OnboardingProgressHeader */}
          <View
            style={{
              borderBottomWidth: 1,
              borderColor: '#1e293b',
              backgroundColor: '#0d1525',
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
              {[
                { num: 1, label: 'Getting to Know', active: true, progress: phase1Progress },
                { num: 2, label: 'Personality Analysis', active: false, progress: 0 },
                { num: 3, label: 'Your Journey', active: false, progress: 0 },
              ].map((phase, i, arr) => {
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
                        ...(phase.active
                          ? { backgroundColor: colors.primary }
                          : {
                              backgroundColor: 'rgba(255,255,255,0.06)',
                              borderWidth: 1,
                              borderColor: 'rgba(255,255,255,0.12)',
                            }),
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '700',
                          color: phase.active
                            ? colors.primaryForeground
                            : 'rgba(255,255,255,0.35)',
                        }}
                      >
                        {phase.num}
                      </Text>
                    </View>
                    {phase.active && (
                      <Text
                        style={{
                          marginLeft: 8,
                          fontSize: 12,
                          fontWeight: '500',
                          color: 'rgba(255,255,255,0.8)',
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
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          overflow: 'hidden',
                        }}
                      >
                        {phase.active && (
                          <View
                            style={{
                              position: 'absolute',
                              top: 0,
                              bottom: 0,
                              left: 0,
                              width: `${Math.max(2, phase.progress)}%`,
                              backgroundColor: colors.primary,
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

          {/* Step label — mirrors web's "GETTING TO KNOW · STEP X / Y" below the stepper */}
          <Text
            style={{
              fontSize: 10,
              fontWeight: '600',
              letterSpacing: 2.5,
              color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase',
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: 4,
            }}
          >
            {`GETTING TO KNOW · STEP ${chatStep + 1} / ${TOTAL_CHAT_STEPS}`}
          </Text>

          {/* Back button — mirrors web's ghost Back button in content area */}
          <View
            style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}
          >
            <Pressable
              onPress={() =>
                navigation.navigate('OnboardingWelcome', { fromBack: true })
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: pressed ? 0.6 : 1,
                alignSelf: 'flex-start',
              })}
            >
              <ChevronLeft size={16} color="rgba(255,255,255,0.5)" />
              <Text
                style={{
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.5)',
                  fontWeight: '500',
                }}
              >
                Back
              </Text>
            </Pressable>
          </View>

          {/* Chat — fills all remaining space; no outer ScrollView here */}
          <View style={{ flex: 1 }}>
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
              onStepChange={setChatStep}
            />
          </View>
        </View>
      )}
    </View>
  );
}
