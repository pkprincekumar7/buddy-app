import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import Animated, { Keyframe } from 'react-native-reanimated';
import { useNavigate, useLocation, useParams } from '@/lib/router';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import {
  children,
  CHILD_ERRORS,
  type Child,
  type ChildIn,
} from '@/api/children';
import { httpErrorMessage } from '@/lib/apiError';
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

    const applyChildData = (child: Child) => {
      const prefill: Partial<ChildFormData> = {};
      if (child.name) prefill.name = child.name;
      if (child.age !== null) prefill.age = String(child.age);
      if (child.gender) {
        const g =
          child.gender.charAt(0).toUpperCase() +
          child.gender.slice(1).toLowerCase();
        if (g === 'Male' || g === 'Female' || g === 'Other') prefill.gender = g;
      }
      if (child.school) prefill.school = child.school;
      if (child.avatar_id) prefill.avatarId = child.avatar_id;
      if (child.avatar_url) prefill.avatarUrl = child.avatar_url;
      setPrefillData(prefill);
    };

    if (childIdParam) {
      setChildId(childIdParam);
      // Fetch the specific child's saved data to pre-fill the form.
      // Authorization is determined by the API response (404 → redirect to /Home).
      void (async () => {
        try {
          const child = await children.get(childIdParam);
          if (cancelled) return;
          setChildComplete(child.progress.conversation);
          applyChildData(child);
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
        const [child] = await children.list('-created_at', 1);
        if (cancelled) return;
        if (child) {
          setChildId(child.id);
          setChildComplete(child.progress.conversation);
          applyChildData(child);
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
        // that child even when its onboarding chat is done. Only gate on childComplete for
        // the auto-flow (/Onboarding with no childId) so we don't create a duplicate
        // every time a completed child's parent revisits the wizard.
        let targetId = childIdParam
          ? childId
          : childId && !childComplete
          ? childId
          : undefined;

        // Only the child's own fields (build plan 7.4); children sets `progress.profile`
        // itself once name, age and gender are all there. An emoji avatar is saved with
        // them; a photo is uploaded afterwards and saved by its key.
        const school = formData.school.trim();
        const fields: ChildIn = {
          name: formData.name.trim(),
          age: Number(formData.age),
          gender: formData.gender,
          school: school === '' ? null : school,
          ...(formData.avatarId ? { avatar_id: formData.avatarId } : {}),
        };
        if (targetId) {
          await children.update(targetId, fields);
        } else {
          targetId = (await children.create(fields)).id;
          setChildId(targetId);
        }

        if (photoFile) {
          try {
            const photo = await (await fetch(photoFile.uri)).blob();
            await children.uploadAvatar(targetId, photo, photoFile.mimeType);
          } catch (uploadErr) {
            console.warn(
              '[Onboarding] Photo upload failed, continuing without photo:',
              uploadErr,
            );
            toast.error(
              `${httpErrorMessage(uploadErr as Error, {
                codeMessages: CHILD_ERRORS,
                fallback: 'Photo upload failed.',
              })} The profile was saved without it.`,
            );
          }
        }
        void navigate(`/ConversationalOnboarding/${targetId}`);
      } catch (err) {
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: CHILD_ERRORS,
            fallback: 'Something went wrong. Please try again.',
          }),
        );
        console.warn('[Onboarding] Could not create/update child:', err);
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
                onContinue={handleProfileContinue}
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
