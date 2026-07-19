import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import WelcomePhase from '@/components/onboarding/WelcomePhase';
import ChildProfileStep from '@/components/onboarding/ChildProfileStep';
import type { ChildFormData } from '@/components/onboarding/ChildProfileStep';
import OnboardingProgressHeader from '@/components/onboarding/OnboardingProgressHeader';
import type { PhaseEntry } from '@/components/onboarding/OnboardingProgressHeader';

export default function Onboarding() {
  const navigate = useNavigate();
  const location = useLocation();
  const forceNew = (location.state as { forceNew?: boolean } | null)?.forceNew ?? false;
  const { childId: childIdParam } = useParams<{ childId?: string }>();

  const { user, isAuthenticated, isLoadingAuth, childProfiles } = useAuth();

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
        const g = raw.gender.charAt(0).toUpperCase() + raw.gender.slice(1).toLowerCase();
        if (g === 'Male' || g === 'Female' || g === 'Other') prefill.gender = g;
      }
      if (typeof raw.school === 'string' && raw.school) prefill.school = raw.school;
      if (typeof raw.avatar_id === 'string' && raw.avatar_id) prefill.avatarId = raw.avatar_id;
      if (typeof raw.avatar_url === 'string' && raw.avatar_url) prefill.avatarUrl = raw.avatar_url;
      setPrefillData(prefill);
    };

    if (childIdParam) {
      const owned = childProfiles.some((c) => c.id === childIdParam);
      if (!owned) {
        navigate('/Home', { replace: true });
        return;
      }
      setChildId(childIdParam);
      // Fetch the specific child's saved data to pre-fill the form
      void (async () => {
        try {
          const child = await api.entities.Child.get(childIdParam);
          if (cancelled || !child) return;
          setChildComplete(!!child.onboarding_completed);
          applyChildData(child);
        } catch (err) {
          console.warn('[Onboarding] Could not load child data:', err);
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
  }, [isLoadingAuth, isAuthenticated, forceNew, childIdParam, childProfiles, navigate]);

  // Step 1 → Step 2 (just UI transition, no API call yet)
  const handleWelcomeContinue = useCallback(() => {
    if (!isAuthenticated) {
      navigate('/Onboarding');
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
        let targetId = childId && !childComplete ? childId : undefined;

        if (!targetId) {
          const created = await api.entities.Child.create({
            onboarding_phase: 1,
            onboarding_completed: false,
          });
          const createdId = (created as Record<string, unknown>)?.id as string | undefined;
          if (createdId) {
            setChildId(createdId);
            targetId = createdId;
          }
        }

        if (targetId) {
          // Upload photo first if provided, then include the URL in the single PATCH
          let avatarUrl: string | undefined;
          if (photoFile) {
            try {
              const result = await api.entities.Child.uploadAvatar(targetId, photoFile);
              avatarUrl = result.avatar_url;
            } catch (uploadErr) {
              console.warn(
                '[Onboarding] Photo upload failed, continuing without photo:',
                uploadErr,
              );
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
          navigate(`/ConversationalOnboarding/${targetId}`);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          toast.error("You've reached the maximum of 10 children. Delete one to add another.");
        } else {
          toast.error('Something went wrong. Please try again.');
          console.warn('[Onboarding] Could not create/update child:', err);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [isAuthenticated, childId, childComplete, navigate],
  );

  const stepLabel = step === 1 ? 'GETTING TO KNOW · STEP 1 / 12' : 'GETTING TO KNOW · STEP 2 / 12';
  const headerPhases: PhaseEntry[] = [
    { num: 1, label: 'Getting to Know', status: 'active', progress: step === 1 ? 8 : 16 },
    { num: 2, label: 'Personality Analysis', status: 'upcoming' },
    { num: 3, label: 'Your Journey', status: 'upcoming' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <OnboardingProgressHeader phases={headerPhases} />

      <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        {/* Step label — left-aligned with card */}
        <div className="mx-auto mb-4 max-w-lg">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
            {stepLabel}
          </p>
        </div>

        {isLoadingAuth || checking ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
            />
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
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
