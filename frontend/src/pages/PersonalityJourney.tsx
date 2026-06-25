import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Star, Compass, Zap, Clock, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { recommendationsJourneySchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft, determinePhase } from '@/lib/onboardingHelpers';
import { buildJourneyRecommendationsPrompt } from '@/lib/prompts';
import { SPINNER } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';
import { useJob } from '@/hooks/useJob';

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

export default function PersonalityJourney() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [profile, setProfile] = useState<ProfileType>(null);
  const [childName, setChildName] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  // Stores merged child data for building the prompt inside enqueue, so the useEffect
  // only needs to run once and doesn't depend on re-render state.
  const mergedRef = useRef<Record<string, unknown> | null>(null);

  const onJourneyComplete = useCallback(async () => {
    if (!childId) return;
    try {
      await api.entities.Child.update(childId, { onboarding_phase: 3 });
    } catch { /* non-fatal */ }
    setIsInitializing(false); // ensures status flips to 'ready'
  }, [childId]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_journey_recommendations',
    onCompleted: onJourneyComplete,
  });

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
        const personality = child.personality;
        const viewModel = personality?.view_model;
        if (!viewModel?.type) {
          navigate(`/PersonalityType/${childId}`, { replace: true });
          return;
        }
        const merged = mergeChildDraft(normalizeOnboardingChildDataBlob(child) ?? {});
        mergedRef.current = merged as Record<string, unknown>;
        setChildName(merged.name || '');
        setChildData(child as Record<string, unknown>);

        const gp = onboardingProfileFromViewModel(viewModel);
        setProfile(gp);

        // Already generated — show immediately
        const recommendations = child.recommendations;
        if (
          recommendations &&
          (typeof recommendations['pathway_overview'] === 'string' ||
            (Array.isArray(recommendations['focus_areas']) &&
              (recommendations['focus_areas'] as unknown[]).length > 0))
        ) {
          setIsInitializing(false);
          return;
        }

        if (!merged.name?.trim()) {
          navigate(`/PersonalityType/${childId}`, { replace: true });
          return;
        }

        // Only enqueue if no active job is already polling (useJob picks it up via childData)
        const activeJobId = (child.active_jobs as Record<string, string> | undefined)
          ?.generate_journey_recommendations;
        if (!activeJobId) {
          const age = parseInt(String(merged.age), 10) || 10;
          const lifePhase = determinePhase(age);
          await job.enqueue({
            type: 'generate_journey_recommendations',
            child_id: childId,
            payload: {
              prompt: buildJourneyRecommendationsPrompt({
                childData: merged,
                age,
                lifePhase,
                personalityType:
                  gp?.personality_type ??
                  `${viewModel?.type ?? 'Unknown'} (${(viewModel?.profile?.['name'] as string) ?? ''})`,
                personalityNarrative: gp?.summary,
                growthAreas: gp?.growth_areas as string[] | undefined,
              }),
              response_json_schema: recommendationsJourneySchema(),
            },
            write_back: { collection: 'children', filter: {}, field: 'recommendations' },
          });
        }
        setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityJourney] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => { cancelled = true; };
    // job.enqueue intentionally excluded — stable ref, adding it re-triggers the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const isGenerating = !isInitializing && job.isLoading;
  const isError = initError || job.isFailed;
  const status = isLoadingAuth || isInitializing
    ? 'loading'
    : isGenerating
      ? 'generating'
      : isError
        ? 'error'
        : 'ready';

  const sectionAnim = (delay: number) => ({
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 1.0, delay, ease: 'easeOut' },
  });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoadingAuth || status === 'loading' ? (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <motion.div
              {...SPINNER}
              className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
            />
          </div>
        ) : status === 'generating' ? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
            <motion.div
              {...SPINNER}
              className="h-12 w-12 rounded-full border-2 border-primary border-t-transparent"
            />
            <p className="max-w-md text-center font-medium text-muted-foreground">
              Mapping personalized recommendations…
            </p>
          </div>
        ) : status === 'error' ? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
            <p className="text-muted-foreground">Something went wrong. Please try again.</p>
            <Button
              onClick={() => navigate(childId ? `/PersonalityType/${childId}` : '/Home')}
              className="btn-primary rounded-2xl px-8"
            >
              Go Back
            </Button>
          </div>
        ) : (
          <div className="min-h-screen bg-background">
            {/* Progress indicator */}
            <div className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
              <div className="mx-auto max-w-4xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  {[
                    { label: 'Getting to Know', icon: '💬', done: true },
                    { label: 'Personality Analysis', icon: '⭐', done: true },
                    { label: 'Your Journey', icon: '💡', active: true },
                  ].map((phase) => (
                    <div
                      key={phase.label}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 transition-all ${
                        phase.active
                          ? 'border border-primary/25 bg-primary/10'
                          : phase.done
                            ? 'border border-success/20 bg-success/10'
                            : 'bg-ghost border-edge-faint opacity-50'
                      }`}
                    >
                      <span className="text-base" aria-hidden="true">
                        {phase.icon}
                      </span>
                      <span
                        className={`hidden text-xs font-medium sm:block ${phase.active ? 'text-primary' : phase.done ? 'text-success-bright' : 'text-muted-foreground'}`}
                      >
                        {phase.label}
                      </span>
                      {phase.done && <span className="text-xs text-success-bright">✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 md:py-12">
              {/* Header */}
              <motion.div {...sectionAnim(0.1)} className="text-center">
                <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-success">
                  <Sparkles className="h-12 w-12 text-white" />
                </div>
                <h2 className="mb-2 text-2xl font-bold text-foreground">
                  Your Personalized Journey
                </h2>
                <p className="text-muted-foreground">
                  Here's what we've discovered about {childName}
                </p>
              </motion.div>

              {/* Profile summary */}
              {profile && (
                <motion.div {...sectionAnim(0.8)} className="border-edge rounded-2xl bg-card p-6">
                  <div className="mb-4 flex items-start gap-4">
                    <div className="glow-teal-sm flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-dark">
                      <Star className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">{childName}'s Profile</h3>
                      <p className="text-sm font-medium text-primary">
                        {profile.personality_type?.split(' - ')[1] ?? profile.personality_type}
                      </p>
                    </div>
                  </div>
                  <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                    {profile.summary}
                  </p>
                  <div className="space-y-2">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Emerging Strengths
                    </p>
                    {(profile.top_strengths as string[])?.map((strength, index) => (
                      <motion.div
                        key={strength}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.8, delay: 1.1 + index * 0.25 }}
                        className="border-edge-faint flex items-start gap-3 rounded-xl bg-surface-input p-3"
                      >
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-warning-medium/15">
                          <span className="text-xs font-bold text-warning">{index + 1}</span>
                        </div>
                        <p className="text-sm font-semibold text-foreground">{strength}</p>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Growth areas prompt */}
              <motion.div
                {...sectionAnim(1.8)}
                className="rounded-2xl border border-personality/20 bg-card p-6"
              >
                <div className="space-y-4 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-personality to-personality-alt-strong">
                    <Compass className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">
                    Do you want to explore the specific growth areas for {childName} to become their
                    best version?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Discover personalized activities to help {childName} develop key life skills
                  </p>
                  <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
                    <Button
                      size="xl"
                      onClick={() => navigate(`/GrowthAreas/${childId}`)}
                      className="rounded-2xl bg-gradient-to-r from-personality to-personality-alt-strong px-8 text-white hover:from-personality-light hover:to-personality-alt"
                    >
                      <Zap className="mr-2 h-4 w-4" />
                      Continue Now
                    </Button>
                    <Button
                      size="xl"
                      variant="outline"
                      onClick={() => navigate('/Home')}
                      className="border-edge-strong rounded-2xl bg-transparent px-8 text-foreground hover:bg-subtle"
                    >
                      <Clock className="mr-2 h-4 w-4" />
                      Catch Up Later
                    </Button>
                  </div>
                </div>
              </motion.div>

              {/* Navigation */}
              <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  size="xl"
                  variant="outline"
                  onClick={() =>
                    navigate(`/PersonalityType/${childId}`, { state: { fromBack: true } })
                  }
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
