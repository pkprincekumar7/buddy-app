import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import Animated, { Keyframe } from 'react-native-reanimated';
import { useNavigate, useLocation, useParams } from '@/lib/router';
import { toast } from '@/lib/toast';
import { ApiError } from '@/api/errors';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import Spinner from '@/components/shared/Spinner';
import PageScroll from '@/components/layout/PageScroll';
import WelcomePhase from '@/components/onboarding/WelcomePhase';
import ChildProfileStep from '@/components/onboarding/ChildProfileStep';
import type {
  ChildFormData,
  ChildPhoto,
} from '@/components/onboarding/ChildProfileStep';

/** Web step-1 `exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.3 }}`. */
const STEP1_EXIT = new Keyframe({
  0: { opacity: 1, transform: [{ translateX: 0 }] },
  100: { opacity: 0, transform: [{ translateX: -40 }] },
}).duration(300);

export default function Onboarding() {
  const navigate = useNavigate();
  const location = useLocation();
  const forceNew =
    (location.state as { forceNew?: boolean } | null)?.forceNew ?? false;
  const { childId: childIdParam } = useParams<{ childId?: string }>();

  const { user, isAuthenticated, isLoadingAuth } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const [childComplete, setChildComplete] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [prefillData, setPrefillData] = useState<Partial<ChildFormData>>({});

  // Resolve which child this session is for
  useEffect(() => {
    if (isLoadingAuth) return;

    let cancelled = false;

    const applyChildData = (raw: Record<string, unknown>) => {
      const prefill: Partial<ChildFormData> = {};
      if (typeof raw.name === 'string' && raw.name) prefill.name = raw.name;
      if (typeof raw.age === 'string') prefill.age = raw.age;
      else if (typeof raw.age === 'number') prefill.age = String(raw.age);
      if (typeof raw.gender === 'string' && raw.gender) {
        const g =
          raw.gender.charAt(0).toUpperCase() +
          raw.gender.slice(1).toLowerCase();
        if (g === 'Male' || g === 'Female' || g === 'Other') prefill.gender = g;
      }
      if (typeof raw.school === 'string' && raw.school)
        prefill.school = raw.school;
      if (typeof raw.avatar_id === 'string' && raw.avatar_id)
        prefill.avatarId = raw.avatar_id;
      if (typeof raw.avatar_url === 'string' && raw.avatar_url)
        prefill.avatarUrl = raw.avatar_url;
      setPrefillData(prefill);
    };

    if (childIdParam) {
      setChildId(childIdParam);
      // Fetch the specific child's saved data to pre-fill the form.
      // Authorization is determined by the API response (404 → redirect to /Home).
      void (async () => {
        try {
          const child = await api.entities.Child.get(childIdParam);
          if (cancelled) return;
          if (!child) {
            void navigate('/Home', { replace: true });
            return;
          }
          setChildComplete(!!child.onboarding_completed);
          applyChildData({ ...child });
        } catch (err) {
          console.warn('[Onboarding] Could not load child data:', err);
          if (!cancelled) void navigate('/Home', { replace: true });
        } finally {
          if (!cancelled) setChecking(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated || forceNew) {
      setChecking(false);
      return;
    }

    void (async () => {
      try {
        const list = await api.entities.Child.list('-created_date', 1);
        if (cancelled) return;
        const listArr = Array.isArray(list) ? list : [];
        const child = listArr[0];
        if (child) {
          setChildId(child.id);
          setChildComplete(!!child.onboarding_completed);
          applyChildData({ ...child });
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
  }, [isLoadingAuth, isAuthenticated, forceNew, childIdParam, navigate]);

  // Step 1 → Step 2 (just UI transition, no API call yet)
  const handleWelcomeContinue = useCallback(() => {
    if (!isAuthenticated) {
      void navigate('/Onboarding');
      return;
    }
    setStep(2);
  }, [isAuthenticated, navigate]);

  // Step 2 → navigate to ConversationalOnboarding (create child + save form data)
  const handleProfileContinue = useCallback(
    async (formData: ChildFormData, photoFile?: ChildPhoto) => {
      if (!isAuthenticated) return;
      setIsSaving(true);
      try {
        // When the user arrived via /Onboarding/:childId (explicit edit), always reuse
        // that child regardless of onboarding_completed. Only gate on childComplete for
        // the auto-flow (/Onboarding with no childId) so we don't create a duplicate
        // every time a completed child's parent revisits the wizard.
        let targetId = childIdParam
          ? childId
          : childId && !childComplete
          ? childId
          : undefined;

        if (!targetId) {
          const created = await api.entities.Child.create({
            onboarding_phase: 1,
            onboarding_completed: false,
          });
          const createdId: unknown = (created as Record<string, unknown> | null)
            ?.id;
          if (typeof createdId === 'string' && createdId) {
            setChildId(createdId);
            targetId = createdId;
          }
        }

        if (targetId) {
          // Upload photo first if provided, then include the URL in the single PATCH
          let avatarUrl: string | undefined;
          if (photoFile) {
            try {
              const result = await api.entities.Child.uploadAvatar(
                targetId,
                photoFile.uri,
                photoFile.mimeType,
              );
              avatarUrl = result.avatar_url;
            } catch (uploadErr) {
              console.warn(
                '[Onboarding] Photo upload failed, continuing without photo:',
                uploadErr,
              );
              toast.error(
                'Photo upload failed — profile saved without a photo.',
              );
            }
          }

          await api.entities.Child.update(targetId, {
            name: formData.name.trim(),
            age: Number(formData.age),
            gender: formData.gender,
            ...(formData.school ? { school: formData.school.trim() } : {}),
            // Always clear the field that was NOT chosen so the DB never holds both.
            ...(formData.avatarId
              ? { avatar_id: formData.avatarId, avatar_url: null }
              : avatarUrl
              ? { avatar_url: avatarUrl, avatar_id: null }
              : !photoFile
              ? { avatar_id: null } // keeping existing photo — clean up any stale avatar_id
              : {}), // upload was attempted but failed — leave DB untouched
          });
          // Marks the first step of the Personality Journey progression chain —
          // required before conversational_onboarding_completed can be set
          // (see backend/app/schemas/children.py's ChildResponse comment).
          api.entities.Child.markProgress(
            targetId,
            'onboarding_profile_completed',
          ).catch(console.error);
          void navigate(`/ConversationalOnboarding/${targetId}`);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          toast.error(
            "You've reached the maximum of 10 children. Delete one to add another.",
          );
        } else {
          toast.error('Something went wrong. Please try again.');
          console.warn('[Onboarding] Could not create/update child:', err);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [isAuthenticated, childId, childIdParam, childComplete, navigate],
  );

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageScroll>
        <View className="w-full max-w-3xl self-center px-4 py-8">
          {isLoadingAuth || checking ? (
            <View className="min-h-[60vh] items-center justify-center">
              <Spinner durationSeconds={1} />
            </View>
          ) : step === 1 ? (
            <Animated.View key="step1" exiting={STEP1_EXIT}>
              <WelcomePhase
                onContinue={handleWelcomeContinue}
                isAuthenticated={isAuthenticated}
                user={user}
              />
            </Animated.View>
          ) : (
            <View key="step2">
              <ChildProfileStep
                onContinue={(data, photoFile) =>
                  void handleProfileContinue(data, photoFile)
                }
                initialData={prefillData}
                isLoading={isSaving}
              />
            </View>
          )}
        </View>
      </PageScroll>
    </KeyboardAvoidingView>
  );
}
