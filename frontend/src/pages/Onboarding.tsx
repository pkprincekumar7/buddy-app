import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { children, CHILD_ERRORS, type Child, type ChildIn } from '@/api/children';
import { httpErrorMessage } from '@/lib/apiError';
import Spinner from '@/components/shared/Spinner';
import WelcomePhase from '@/components/onboarding/WelcomePhase';
import ChildProfileStep from '@/components/onboarding/ChildProfileStep';
import type { ChildFormData } from '@/components/onboarding/ChildProfileStep';

export default function Onboarding() {
  const navigate = useNavigate();
  const location = useLocation();
  const forceNew = (location.state as { forceNew?: boolean } | null)?.forceNew ?? false;
  const { childId: childIdParam } = useParams<{ childId?: string }>();

  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const queryClient = useQueryClient();

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
        const g = child.gender.charAt(0).toUpperCase() + child.gender.slice(1).toLowerCase();
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
          // An existing child (resuming setup, or Edit profile): straight to the form.
          setStep(2);
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

    if (!isAuthenticated) {
      setChecking(false);
      return;
    }

    // "+ Add Child": a new child. A parent adding another one has seen the welcome
    // step already, so open at the profile form.
    if (forceNew) {
      void (async () => {
        try {
          const [existing] = await children.list('-created_at', 1);
          if (!cancelled && existing) setStep(2);
        } catch (err) {
          console.warn('[Onboarding] Could not check for other children:', err);
        } finally {
          if (!cancelled) setChecking(false);
        }
      })();
      return () => {
        cancelled = true;
      };
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
    async (formData: ChildFormData, photoFile?: File) => {
      if (!isAuthenticated) return;
      setIsSaving(true);
      try {
        // When the user arrived via /Onboarding/:childId (explicit edit), always reuse
        // that child even when its onboarding chat is done. Only gate on childComplete for
        // the auto-flow (/Onboarding with no childId) so we don't create a duplicate
        // every time a completed child's parent revisits the wizard.
        let targetId = childIdParam ? childId : childId && !childComplete ? childId : undefined;

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
        // The profile menu and Home list the children: show the new or renamed one now.
        void queryClient.invalidateQueries({ queryKey: ['children'] });

        if (photoFile) {
          try {
            await children.uploadAvatar(targetId, photoFile, photoFile.type);
            void queryClient.invalidateQueries({ queryKey: ['children'] });
          } catch (uploadErr) {
            console.warn('[Onboarding] Photo upload failed, continuing without photo:', uploadErr);
            toast.error(
              `${httpErrorMessage(uploadErr as Error, {
                codeMessages: CHILD_ERRORS,
                fallback: 'Photo upload failed.',
              })} The profile was saved without it.`,
            );
          }
        }
        // Edit profile on a finished child: the chat is done, so back to where the
        // parent opened the form, or to the journey when the form was opened directly.
        if (childIdParam && childComplete) {
          if (location.key !== 'default') void navigate(-1);
          else void navigate(`/PersonalityJourney/${targetId}`, { replace: true });
          return;
        }
        // A child created here gets its own address in history, so Back from the chat
        // reopens this child's form instead of an empty one that would add it again.
        if (!childIdParam && targetId !== childId) {
          void navigate(`/Onboarding/${targetId}`, { replace: true });
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
    [isAuthenticated, childId, childIdParam, childComplete, navigate, queryClient, location.key],
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        {isLoadingAuth || checking ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Spinner durationSeconds={1} />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div key="step1" exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.3 }}>
                <WelcomePhase
                  onContinue={handleWelcomeContinue}
                  isAuthenticated={isAuthenticated}
                  user={user}
                />
              </motion.div>
            ) : (
              <motion.div key="step2">
                <ChildProfileStep
                  onContinue={(data, photoFile) => void handleProfileContinue(data, photoFile)}
                  initialData={prefillData}
                  isLoading={isSaving}
                  {...(childIdParam &&
                    childComplete && {
                      submitLabel: 'Save changes',
                      onViewAnswers: () =>
                        void navigate(`/ConversationalOnboarding/${childIdParam}`),
                    })}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
