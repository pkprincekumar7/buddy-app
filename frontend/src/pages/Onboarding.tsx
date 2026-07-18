import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
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
  const location = useLocation();
  // When navigated with { state: { forceNew: true } }, skip preloading an in-progress child
  // so the user starts a brand-new onboarding rather than resuming an existing one.
  const forceNew = (location.state as { forceNew?: boolean } | null)?.forceNew ?? false;

  // childIdParam: present when navigating to /Onboarding/:childId (resuming an existing
  // child). When absent the page is at bare /Onboarding (new-child flow).
  // TO ENABLE MULTIPLE CHILDREN: each child's entry point already passes its own id via
  // the URL — no further changes needed here.
  const { childId: childIdParam } = useParams<{ childId?: string }>();

  const { user, isAuthenticated, isLoadingAuth, childProfiles } = useAuth();
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(true);
  const [showSplash, startTimer] = useStageSplash(0);

  // Resolve which child this Onboarding session is for:
  // 1. childIdParam in URL  → use it directly, no fetch needed
  // 2. forceNew or not authenticated → no preload, handleContinue will create a new child
  // 3. Otherwise → fetch the most recent in-progress child and reuse it
  useEffect(() => {
    if (isLoadingAuth) return;
    if (childIdParam) {
      const owned = childProfiles.some((c) => c.id === childIdParam);
      if (owned) {
        setChildId(childIdParam);
      } else {
        navigate('/Home', { replace: true });
      }
      setChecking(false);
      return;
    }
    if (!isAuthenticated || forceNew) {
      setChecking(false);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const list = await api.entities.Child.list('-created_date', 1);
        if (cancelled) return;
        const listArr = Array.isArray(list) ? list : [];
        const child = listArr[0];
        // A child is considered complete if onboarding_completed is true OR
        // if recommendations already exist (matches ChildCard's completion check).
        const alreadyComplete = !!child?.onboarding_completed || !!child?.recommendations;
        if (child && !alreadyComplete) {
          setChildId(child.id);
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
        const createdId = created?.id;
        if (createdId) {
          setChildId(createdId);
          targetId = createdId;
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          toast.error(`You've reached the maximum of 10 children. Delete one to add another.`);
        } else {
          console.warn('[Onboarding] Could not create child stub:', err);
        }
        return;
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
              className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
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
                  size="xl"
                  variant="outline"
                  onClick={() => navigate('/Home')}
                  className="btn-secondary w-full rounded-2xl sm:w-auto"
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
