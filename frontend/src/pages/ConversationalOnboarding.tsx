import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StartOverButton from '@/components/shared/StartOverButton';
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
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [hasPersonality, setHasPersonality] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // bootKey is a static mount key for the chat component; held as a constant since it never changes.
  const bootKey = 0;

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;

        if (!child) {
          navigate('/Home', { replace: true });
          return;
        }

        // Preload existing data — no auto-redirect forward even if personality is ready.
        const viewModel = child.personality?.view_model;
        const personalityReady = !!(viewModel?.type && viewModel?.profile);
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
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

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
      navigate(`/PersonalityType/${childId}`);
    },
    [childData, childId, hasPersonality, navigate],
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
          <div className="min-h-screen bg-background">
            {/* Progress indicator */}
            <div className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
              <div className="mx-auto max-w-4xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  {[
                    { label: 'Getting to Know', icon: '💬', active: true },
                    { label: 'Personality Analysis', icon: '⭐', active: false },
                    { label: 'Your Journey', icon: '💡', active: false },
                  ].map((phase) => (
                    <div
                      key={phase.label}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 transition-all ${
                        phase.active
                          ? 'border border-primary/25 bg-primary/10'
                          : 'bg-ghost border-edge-faint opacity-50'
                      }`}
                    >
                      <span className="text-base" aria-hidden="true">
                        {phase.icon}
                      </span>
                      <span
                        className={`hidden text-xs font-medium sm:block ${phase.active ? 'text-primary' : 'text-muted-foreground'}`}
                      >
                        {phase.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-auto max-w-3xl px-4 py-8">
              <ConversationalOnboardingChat
                key={bootKey}
                user={user}
                activeChildId={childId}
                resumeHydrationReady={hydrated}
                onComplete={handleComplete}
                onContinueToPersonality={() => {
                  void handleComplete({});
                }}
                onQuestionnairePersisted={(slice) =>
                  setChildData((prev) => mergeChildDraft({ ...(prev ?? {}), ...slice }))
                }
                onQuestionnaireCleared={() => setChildData(null)}
              />

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  size="xl"
                  variant="outline"
                  onClick={() => navigate('/Onboarding', { state: { fromBack: true } })}
                  className="btn-secondary w-full rounded-2xl sm:w-auto"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
                <StartOverButton childId={childId} className="w-full sm:w-auto" />
              </div>
            </div>
          </div>
        )}
      </motion.div>

      <AnimatePresence></AnimatePresence>
    </>
  );
}
