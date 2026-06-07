import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { CheckCircle2, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { GROWTH_AREAS } from '@/lib/growthAreaData';
import { SPINNER } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';

export default function GrowthAreas() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [completedAreaIds, setCompletedAreaIds] = useState<Set<string | undefined>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [showSplash, startTimer] = useStageSplash();

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
        if (!child.personality?.view_model?.type) {
          navigate(`/PersonalityType/${childId}`, { replace: true });
          return;
        }

        const areas = await api.completedGrowthAreas.list(childId);
        if (cancelled) return;
        const allDocs = areas.areas ?? [];
        const done = new Set(
          allDocs
            .filter(
              (a) =>
                a.status === 'completed' ||
                !a.status ||
                (Array.isArray(a.ai_three_month_recommendations) &&
                  a.ai_three_month_recommendations.length > 0),
            )
            .map((a) => a.area_id),
        );
        setCompletedAreaIds(done);
      } catch (err) {
        console.warn('[GrowthAreas] Load failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const anyDone = completedAreaIds.size >= 1;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
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
          <div key={showSplash ? 'splash' : 'content'} className="min-h-screen bg-background">
            <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
                className="mb-8 text-center"
              >
                <h2 className="mb-2 text-2xl font-bold text-foreground">Growth Areas</h2>
                <p className="text-muted-foreground">Choose an area to explore</p>
              </motion.div>

              <div className="grid grid-cols-2 gap-3">
                {GROWTH_AREAS.map((area, i) => {
                  const Icon = area.icon;
                  const done = completedAreaIds.has(area.id);
                  return (
                    <motion.button
                      key={area.id}
                      type="button"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{
                        opacity: { duration: 0.8, delay: 0.2 + i * 0.1, ease: 'easeOut' },
                        y: { duration: 0.8, delay: 0.2 + i * 0.1, ease: 'easeOut' },
                        scale: { duration: 0.15, delay: 0 },
                      }}
                      onClick={() =>
                        navigate(`/GrowthAreas/${childId}/Activity/${area.urlName}?q=1`)
                      }
                      className={`relative flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-all hover:scale-[1.02] ${
                        done
                          ? 'border-success/30 bg-success/10'
                          : 'border-edge-faint bg-card hover:border-border'
                      }`}
                    >
                      <div
                        className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${area.color}`}
                      >
                        <Icon className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground">{area.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{area.description}</p>
                      </div>
                      {done && (
                        <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-success-bright" />
                      )}
                    </motion.button>
                  );
                })}
              </div>

              <PageActions
                className="mt-8"
                left={
                  <Button
                    size="xl"
                    variant="outline"
                    onClick={() =>
                      navigate(`/PersonalityJourney/${childId}`, { state: { fromBack: true } })
                    }
                    className="btn-secondary w-full rounded-2xl sm:w-auto"
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                }
                center={<StartOverButton childId={childId} className="w-full sm:w-auto" />}
                right={
                  anyDone && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="w-full sm:w-auto"
                    >
                      <Button
                        size="xl"
                        onClick={() => navigate(`/LifePathway/${childId}`)}
                        className="w-full rounded-2xl bg-gradient-to-r from-primary-medium to-success-strong px-10 text-white sm:w-auto"
                      >
                        View Your Life Pathway
                      </Button>
                    </motion.div>
                  )
                }
              />
            </div>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {showSplash && <StageSplash stage={5} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
