import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import WelcomePhase from '@/components/onboarding/WelcomePhase';
import StartOverButton from '@/components/shared/StartOverButton';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { slideUp } from '@/lib/animations';

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(true);
  const [showSplash, startTimer] = useStageSplash();

  // Preload any existing in-progress child so Continue reuses it instead of creating a new one.
  // No auto-redirects — the user always navigates step by step.
  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      setChecking(false);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const list = await api.entities.Child.list('-created_date', 1);
        if (cancelled) return;
        const listArr = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
        const child = listArr[0];
        if (child && !child['onboarding_completed']) {
          setChildId(child['id'] as string);
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
  }, [isLoadingAuth, isAuthenticated]);

  const handleContinue = useCallback(async () => {
    if (!isAuthenticated) {
      navigate('/Onboarding');
      return;
    }
    let targetId = childId;
    if (!targetId) {
      try {
        const created = await api.entities.Child.create({
          onboarding_phase: 1,
          onboarding_completed: false,
        });
        const createdRecord = created as Record<string, unknown> | null;
        const createdId = createdRecord?.['id'] as string | undefined;
        if (createdId) {
          setChildId(createdId);
          targetId = createdId;
        }
      } catch (err) {
        console.warn('[Onboarding] Could not create child stub:', err);
      }
    }
    if (targetId) navigate(`/ConversationalOnboarding/${targetId}`);
  }, [isAuthenticated, childId, navigate]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoadingAuth || checking ? (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent"
            />
          </div>
        ) : (
          <motion.div
            key={showSplash ? 'splash' : 'content'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="min-h-screen bg-background"
          >
            <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
              <WelcomePhase
                onContinue={() => {
                  void handleContinue();
                }}
                isAuthenticated={isAuthenticated}
                user={user}
              />
              <motion.div
                {...slideUp(2.7, 0.7)}
                className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <Button
                  variant="outline"
                  onClick={() => navigate('/Home')}
                  className="btn-secondary h-12 w-full rounded-2xl px-6 sm:w-auto"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
                <StartOverButton childId={childId} className="w-full sm:w-auto" />
              </motion.div>
            </div>
          </motion.div>
        )}
      </motion.div>

      <AnimatePresence>
        {showSplash && <StageSplash stage={1} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
