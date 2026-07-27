import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OnboardingProgressHeader from '@/components/onboarding/OnboardingProgressHeader';
import type { PhaseEntry } from '@/components/onboarding/OnboardingProgressHeader';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import ConversationalOnboardingChat from '@/components/onboarding/ConversationalOnboarding';
import { SPINNER } from '@/lib/animations';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';

export default function ConversationalOnboarding() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [_childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const childDataRef = useRef<Record<string, unknown> | null>(null);
  const [hasPersonality, setHasPersonality] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // bootKey is a static mount key for the chat component; held as a constant since it never changes.
  const bootKey = 0;

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;

        if (!child) {
          void navigate('/Home', { replace: true });
          return;
        }

        // Preload existing data — no auto-redirect forward even if personality is ready.
        const viewModel = child.personality?.view_model;
        const personalityReady = !!(viewModel?.type && viewModel?.profile);
        setHasPersonality(personalityReady);
        const normalized = normalizeOnboardingChildDataBlob(child);
        if (normalized) {
          const merged = mergeChildDraft(normalized);
          childDataRef.current = merged;
          setChildData(merged);
        }
      } catch (err) {
        console.warn('[ConversationalOnboarding] Hydration failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const handleQuestionnairePersisted = useCallback((slice: Record<string, unknown>) => {
    const merged = mergeChildDraft({ ...(childDataRef.current ?? {}), ...slice });
    childDataRef.current = merged;
    setChildData(merged);
  }, []);

  const handleComplete = useCallback(
    async (conversationData: Record<string, unknown>) => {
      const mergedDraft = mergeChildDraft({ ...(childDataRef.current ?? {}), ...conversationData });
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
        console.warn('[ConversationalOnboarding] Could not save chatbot data:', err);
      }
      void navigate(`/PersonalityType/${childId}`);
    },
    [childId, hasPersonality, navigate],
  );

  return (
    <>
      {/* Page content — hidden while splash is showing, then fades in smoothly */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoadingAuth || !hydrated ? (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <motion.div
              {...SPINNER}
              className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
            />
          </div>
        ) : (
          <div className="flex h-[calc(100vh-4rem)] flex-col bg-[var(--bg-deep-3)]">
            {/* Progress header — matches /Onboarding style */}
            {(() => {
              const headerPhases: PhaseEntry[] = [
                { num: 1, label: 'Getting to Know', status: 'active', progress: 33 },
                { num: 2, label: 'Personality Analysis', status: 'upcoming' },
                { num: 3, label: 'Your Journey', status: 'upcoming' },
              ];
              return (
                <OnboardingProgressHeader
                  phases={headerPhases}
                  stepLabel="GETTING TO KNOW · STEP 3 / 12"
                />
              );
            })()}

            {/* Back button row */}
            <div className="mx-auto w-full max-w-5xl px-4 pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigate(childId ? `/Onboarding/${childId}` : '/Onboarding', {
                    state: { fromBack: true },
                  });
                }}
                className="gap-1 rounded-xl text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            </div>

            {/* Chat fills remaining height */}
            <div className="flex flex-1 flex-col">
              <ConversationalOnboardingChat
                key={bootKey}
                user={user}
                activeChildId={childId}
                resumeHydrationReady={hydrated}
                onComplete={handleComplete}
                onContinueToPersonality={() => {
                  void handleComplete({});
                }}
                onQuestionnairePersisted={handleQuestionnairePersisted}
                onQuestionnaireCleared={() => setChildData(null)}
              />
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}
