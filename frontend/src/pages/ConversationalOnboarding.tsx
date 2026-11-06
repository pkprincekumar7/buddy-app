import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { onboarding, answersFrom, ONBOARDING_ERRORS } from '@/api/onboarding';
import ConversationalOnboardingChat from '@/components/onboarding/ConversationalOnboarding';
import PageLoader from '@/components/shared/PageLoader';
import { httpErrorMessage } from '@/lib/apiError';
import { Button } from '@/components/ui/button';

// The conversational onboarding (build plan 7.5): the chat keeps the answers until the
// end, then this page saves all seven in one PUT and goes on to the Personality Journey.
// Discover starts the personality by itself, and the hub waits for it.

export default function ConversationalOnboarding() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  // What the chat resumed from (the child's fields, and any saved answers).
  const draftRef = useRef<Record<string, unknown>>({});
  const [hydrated, setHydrated] = useState(false);
  // The answers being saved, kept for "Try again" after a failed save.
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
        const draft = await onboarding.draft(childId);
        if (!cancelled) draftRef.current = draft;
      } catch (err) {
        console.warn('[ConversationalOnboarding] Hydration failed:', err);
        if (!cancelled) void navigate('/Home', { replace: true });
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const save = useCallback(
    async (collected: Record<string, unknown>) => {
      if (!childId) return;
      pendingRef.current = collected;
      setSaveError(null);
      const answers = answersFrom(collected);
      if (!answers) {
        setSaveError('Some answers are missing. Please go through the chat again.');
        return;
      }
      try {
        await onboarding.save(childId, answers);
      } catch (err) {
        console.warn('[ConversationalOnboarding] Could not save the answers:', err);
        setSaveError(
          httpErrorMessage(err as Error, {
            codeMessages: ONBOARDING_ERRORS,
            fallback: "We couldn't save your answers. Please try again.",
          }),
        );
        return;
      }
      void navigate(`/PersonalityJourney/${childId}`);
    },
    [childId, navigate],
  );

  const handleComplete = useCallback(
    (conversationData: Record<string, unknown>) =>
      save({ ...draftRef.current, ...conversationData }),
    [save],
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
          <PageLoader />
        ) : (
          <div className="relative flex h-[calc(100vh-7rem)] flex-col bg-[var(--bg-deep-3)]">
            {/* Chat fills remaining height */}
            <div className="flex min-h-0 flex-1 flex-col">
              <ConversationalOnboardingChat
                key={bootKey}
                user={user}
                activeChildId={childId}
                resumeHydrationReady={hydrated}
                onComplete={handleComplete}
                onContinueToPersonality={() => {
                  void handleComplete({});
                }}
              />
            </div>

            {/* Error overlay — fades in over the loading screen when the save fails */}
            <AnimatePresence>
              {saveError !== null && (
                <motion.div
                  key="save-error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 pb-20"
                  style={{ background: 'var(--bg-deep-3)' }}
                >
                  <p className="w-full max-w-2xl text-center text-3xl font-bold leading-[1.08] text-white/90 sm:text-4xl">
                    Something went wrong
                  </p>
                  <p className="text-center text-base text-white/60">{saveError}</p>
                  <Button
                    onClick={() => void save(pendingRef.current ?? draftRef.current)}
                    size="lg"
                    className="mt-4"
                  >
                    Try again
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </>
  );
}
