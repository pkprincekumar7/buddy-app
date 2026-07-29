import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeOutLeft } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSlideUpWhenReady } from '@/lib/animations';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '@/navigation';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import { toast } from '@/lib/toast';
import WelcomePhase from '@/components/onboarding/WelcomePhase';
import ChildProfileStep from '@/components/onboarding/ChildProfileStep';
import type { ChildFormData, PhotoAsset } from '@/components/onboarding/ChildProfileStep';
import { useTheme } from '@/lib/ThemeContext';

type OnboardingNavigationProp = StackNavigationProp<
  OnboardingStackParamList,
  'OnboardingWelcome'
>;

export default function OnboardingScreen() {
  const navigation = useNavigation<OnboardingNavigationProp>();
  const route = useRoute<RouteProp<OnboardingStackParamList, 'OnboardingWelcome'>>();
  const childIdParam = route.params?.childId;
  const { colors } = useTheme();
  const {
    user,
    isAuthenticated,
    isLoading,
    activeChildId,
    setActiveChildId,
    refetchChildren,
  } = useAuth();

  // When editing a specific child via childIdParam, go straight to the profile form (step 2).
  const [step, setStep] = useState<1 | 2>(childIdParam ? 2 : 1);
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const [childComplete, setChildComplete] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [prefillData, setPrefillData] = useState<Partial<ChildFormData>>({});

  // Preload any existing in-progress child so Continue reuses it instead of creating a new one.
  // Skipped when the 'buddy360:forceNewOnboarding' AsyncStorage flag is set (e.g. "Add Child").
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setChecking(false);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        // Direct edit of a specific child — mirrors web /Onboarding/:childId
        if (childIdParam) {
          setChildId(childIdParam);
          const child = await api.entities.Child.get(childIdParam);
          if (cancelled) return;
          setChildComplete(!!child.onboarding_completed);
          const prefill: Partial<ChildFormData> = {};
          if (typeof child.name === 'string' && child.name) prefill.name = child.name;
          if (child.age != null) prefill.age = String(child.age);
          if (typeof child.gender === 'string' && child.gender) {
            const g =
              child.gender.charAt(0).toUpperCase() +
              child.gender.slice(1).toLowerCase();
            if (g === 'Male' || g === 'Female' || g === 'Other')
              prefill.gender = g as ChildFormData['gender'];
          }
          if (typeof child.school === 'string' && child.school)
            prefill.school = child.school;
          if (typeof child.avatar_id === 'string' && child.avatar_id)
            prefill.avatarId = child.avatar_id;
          if (typeof child.avatar_url === 'string' && child.avatar_url)
            prefill.avatarUrl = child.avatar_url;
          setPrefillData(prefill);
          if (!cancelled) setChecking(false);
          return;
        }

        const forceNew = await AsyncStorage.getItem(
          'buddy360:forceNewOnboarding',
        ).catch(() => null);
        if (forceNew) {
          await AsyncStorage.removeItem('buddy360:forceNewOnboarding').catch(
            () => {},
          );
          if (!cancelled) setChecking(false);
          return;
        }
        const list = await api.entities.Child.list('-created_date', 1);
        if (cancelled) return;
        const listArr = Array.isArray(list) ? list : [];
        const childSummary = listArr[0];
        if (childSummary) {
          setChildId(childSummary.id as string);
          setChildComplete(!!childSummary.onboarding_completed);
          // Fetch full child for prefill AND for an authoritative
          // onboarding_completed value (list projection can be stale).
          const child = await api.entities.Child.get(
            childSummary.id as string,
          );
          if (cancelled) return;
          // Mirror the childIdParam branch: use the GET result for childComplete
          // so the gate in handleProfileContinue has the authoritative value.
          setChildComplete(!!child.onboarding_completed);
          const prefill: Partial<ChildFormData> = {};
          if (typeof child.name === 'string' && child.name)
            prefill.name = child.name;
          if (child.age != null)
            prefill.age = String(child.age);
          if (typeof child.gender === 'string' && child.gender) {
            const g =
              child.gender.charAt(0).toUpperCase() +
              child.gender.slice(1).toLowerCase();
            if (g === 'Male' || g === 'Female' || g === 'Other')
              prefill.gender = g as ChildFormData['gender'];
          }
          if (typeof child.school === 'string' && child.school)
            prefill.school = child.school;
          if (typeof child.avatar_id === 'string' && child.avatar_id)
            prefill.avatarId = child.avatar_id;
          if (typeof child.avatar_url === 'string' && child.avatar_url)
            prefill.avatarUrl = child.avatar_url;
          setPrefillData(prefill);
        }
      } catch (err) {
        console.warn('[Onboarding] Preload failed:', err);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, childIdParam]);

  const contentStyle = useSlideUpWhenReady(!isLoading && !checking);

  // Step 1 → Step 2 (no API call yet — mirrors web handleWelcomeContinue)
  const handleWelcomeContinue = useCallback(() => {
    if (!isAuthenticated) {
      navigation.navigate('OnboardingWelcome');
      return;
    }
    setStep(2);
  }, [isAuthenticated, navigation]);

  // Step 2 → ConversationalOnboarding (create child + save form data — mirrors web handleProfileContinue)
  const handleProfileContinue = useCallback(
    async (formData: ChildFormData, photo?: PhotoAsset) => {
      if (!isAuthenticated) return;
      setIsSaving(true);
      try {
        // Reuse the preloaded child when one was found (no forceNew) — the forceNew
        // path already leaves childId undefined, so new-child creation only happens
        // when there is truly nothing to reuse (first visit or explicit "Add Child").
        let targetId = childId;

        if (!targetId) {
          const created = await api.entities.Child.create({
            onboarding_phase: 1,
            onboarding_completed: false,
          });
          const createdId = created?.id as string | undefined;
          if (createdId) {
            setChildId(createdId);
            targetId = createdId;
            await refetchChildren();
          }
        }

        if (targetId) {
          // Upload photo first if provided, then include the URL in the PATCH — mirrors web
          let avatarUrl: string | undefined;
          if (photo) {
            try {
              const result = await api.entities.Child.uploadAvatar(
                targetId,
                photo.uri,
                photo.mimeType,
              );
              avatarUrl = result.avatar_url;
            } catch (uploadErr) {
              console.warn('[Onboarding] Photo upload failed:', uploadErr);
              toast.error('Photo upload failed — profile saved without a photo.');
            }
          }
          await api.entities.Child.update(targetId, {
            name: formData.name.trim(),
            age: Number(formData.age),
            gender: formData.gender,
            ...(formData.school ? { school: formData.school.trim() } : {}),
            ...(formData.avatarId ? { avatar_id: formData.avatarId } : {}),
            ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
          });
          // Keep prefillData in sync so ChildProfileStep re-mounts with correct
          // selections if the user navigates back within the same session.
          // The web gets this for free (full remount on SPA navigation).
          setPrefillData({
            name: formData.name.trim(),
            age: formData.age,
            gender: formData.gender,
            school: formData.school,
            avatarId: formData.avatarId,
            ...(avatarUrl ? { avatarUrl } : {}),
          });
          if (targetId !== activeChildId) setActiveChildId(targetId);
          navigation.navigate('ConversationalOnboarding');
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          toast.error(
            `You've reached the maximum of 10 children. Delete one to add another.`,
          );
        } else {
          toast.error('Something went wrong. Please try again.');
          console.warn('[Onboarding] Could not create/update child:', err);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [
      isAuthenticated,
      childId,
      childIdParam,
      navigation,
      activeChildId,
      setActiveChildId,
      refetchChildren,
    ],
  );

  if (isLoading || checking) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.background }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const stepLabel =
    step === 1
      ? 'GETTING TO KNOW · STEP 1 / 12'
      : 'GETTING TO KNOW · STEP 2 / 12';
  const phaseProgress = step === 1 ? 8 : 16;

  return (
    <View style={{ flex: 1 }}>
      <Animated.View
        style={[contentStyle, { backgroundColor: colors.background }]}
        className="flex-1"
      >
        {/* Phase bar — mirrors web OnboardingProgressHeader (numbered stepper) */}
        <View style={{ borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
            {[
              { num: 1, label: 'Getting to Know', active: true, progress: phaseProgress },
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
                    ...(isLast ? { flexGrow: 0, flexShrink: 0 } : { flex: phase.active ? 2 : 1 }),
                  }}
                >
                  {/* Numbered circle — teal when active, muted when upcoming */}
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
                        : { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border }),
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: phase.active ? colors.primaryForeground : colors.textMuted,
                        opacity: phase.active ? 1 : 0.4,
                      }}
                    >
                      {phase.num}
                    </Text>
                  </View>

                  {/* Label — only shown for the active phase on mobile */}
                  {phase.active && (
                    <Text
                      style={{ marginLeft: 8, fontSize: 12, fontWeight: '500', color: colors.text, flexShrink: 1 }}
                      numberOfLines={1}
                    >
                      {phase.label}
                    </Text>
                  )}

                  {/* Connecting progress line — not after the last item */}
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

        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 32,
            paddingBottom: 40,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="max-w-3xl w-full self-center">
            {/* Step label — mirrors web */}
            <Text
              className="text-[10px] font-semibold uppercase mb-4"
              style={{
                letterSpacing: 2.5,
                color: colors.textMuted,
                opacity: 0.6,
              }}
            >
              {stepLabel}
            </Text>

            <Animated.View
              key={step}
              entering={FadeIn.duration(300)}
              exiting={FadeOutLeft.duration(250)}
            >
              {step === 1 ? (
                <WelcomePhase
                  onContinue={handleWelcomeContinue}
                  isAuthenticated={isAuthenticated}
                  user={user}
                />
              ) : (
                <ChildProfileStep
                  onContinue={(data, photo) => void handleProfileContinue(data, photo)}
                  initialData={prefillData}
                  isLoading={isSaving}
                />
              )}
            </Animated.View>

          </View>
        </ScrollView>
      </Animated.View>

    </View>
  );
}
