import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, ChevronLeft, ChevronRight, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { areaByUrlName, AREA_QUESTIONS } from '@/lib/growthAreaData';
import type { Question } from '@/lib/growthAreaData';
import { normalizeChildGameRecommendations } from '@/components/onboarding/ChildActivityGame';
import { buildGrowthAreaRecommendationsPrompt } from '@/lib/prompts';
import { SPINNER } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import { useJob } from '@/hooks/useJob';

export default function GrowthAreasActivityGreatInsights() {
  const navigate = useNavigate();
  const { childId, activity } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();

  const area = areaByUrlName(activity ?? '');

  type GameResults = { summary?: string; strengths?: string[]; suggested_activities?: string[] };
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [childGender, setChildGender] = useState('');
  const [recommendations, setRecommendations] = useState<string[] | null>(null);
  const [interactiveAnswers, setInteractiveAnswers] = useState<Record<string, unknown>>({});
  const [childGameResults, setChildGameResults] = useState<GameResults | null>(null);
  // loading → initial DB fetch | idle → no cached recs, waiting for button | ready → recs available | error → load failed
  const [status, setStatus] = useState('loading');
  // Stores the area entry data pre-saved before enqueueing so the onCompleted callback can finalize it.
  const pendingAreaDataRef = useRef<Record<string, unknown> | null>(null);

  const finalizeRecommendations = useCallback(async () => {
    if (!childId || !area) return;
    try {
      const completedData = await api.completedGrowthAreas.list(childId);
      const allDocs = completedData.areas ?? [];
      const areaDoc = allDocs.find((a) => a.area_id === area.id);
      const pendingRaw = areaDoc?.pending_recommendations as Record<string, unknown> | undefined;
      const pending = Array.isArray(pendingRaw)
        ? (pendingRaw as string[])
        : Array.isArray(pendingRaw?.recommendations)
          ? (pendingRaw.recommendations as string[])
          : undefined;
      if (pending && pending.length > 0) {
        setRecommendations(pending);
        await api.completedGrowthAreas.append(childId, {
          ...(pendingAreaDataRef.current ?? {}),
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          status: 'completed',
          step: 'activity_summary',
          ai_three_month_recommendations: pending,
        });
        pendingAreaDataRef.current = null;
      }
      setStatus('ready');
    } catch (err) {
      console.error('[GrowthAreasActivityGreatInsights] Failed to finalize recommendations:', err);
      toast.error('Recommendations are ready — refresh to see them.');
    }
  }, [childId, area]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_recommendations',
    onCompleted: finalizeRecommendations,
  });
  const { enqueue: jobEnqueue } = job;

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
    if (!area) {
      navigate(`/GrowthAreas/${childId}`, { replace: true });
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

        setChildName(child.name ?? '');
        setChildAge(child.age != null ? String(child.age) : '');
        setChildGender(typeof child.gender === 'string' ? child.gender : '');
        setChildData(child);

        const completedData = await api.completedGrowthAreas.list(child.id);
        if (cancelled) return;
        const allDocs = completedData.areas ?? [];
        const areaDoc =
          allDocs.find((a) => a.area_id === area.id && a.status === 'in_progress') ??
          allDocs.find((a) => a.area_id === area.id);

        const ia = areaDoc?.interactive_answers ?? {};
        setInteractiveAnswers(ia);

        const childActivity = areaDoc?.child_activity;
        const rawGameResults = childActivity?.['results'];
        if (rawGameResults) {
          setChildGameResults(normalizeChildGameRecommendations(rawGameResults));
        }

        // DB hit: recommendations already exist — show immediately
        const aiRecs = areaDoc?.ai_three_month_recommendations;
        const recs = areaDoc?.recommendations;
        const cached =
          Array.isArray(aiRecs) && aiRecs.length > 0
            ? aiRecs
            : Array.isArray(recs) && recs.length > 0
              ? recs
              : null;

        if (cached) {
          setRecommendations(cached);
          setStatus('ready');
          return;
        }

        // No cached recs — wait for user to click the button
        setStatus('idle');
      } catch (err) {
        console.warn('[GrowthAreasActivityGreatInsights] Load failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, activity, area, navigate]);

  const generateRecommendations = useCallback(async () => {
    if (!area || !childId) return;

    const questions: Question[] = AREA_QUESTIONS[area.id] ?? [];
    const qaContext = questions
      .filter((q) => interactiveAnswers[q.id])
      .map(
        (q) =>
          `Q: ${q.question.replace(/\{name\}/g, childName || 'the child')}\nA: ${String(interactiveAnswers[q.id])}`,
      )
      .join('\n\n');

    try {
      // Pre-save area entry with answers so the worker's write_back has a doc to update.
      await api.completedGrowthAreas.append(childId, {
        area_id: area.id,
        area_name: area.name,
        area_color: area.color,
        answers: interactiveAnswers,
        status: 'in_progress',
        step: 'activity_summary',
        interactive_answers: interactiveAnswers,
      });
      // Store for finalization in onCompleted
      pendingAreaDataRef.current = {
        answers: interactiveAnswers,
        interactive_answers: interactiveAnswers,
      };

      await jobEnqueue({
        type: 'generate_recommendations',
        child_id: childId,
        payload: {
          prompt: buildGrowthAreaRecommendationsPrompt({
            childName: childName || 'the child',
            childAge: childAge || null,
            childGender: childGender || null,
            areaName: area.name,
            qaContext,
            childGameSummary: childGameResults?.summary ?? null,
            childGameStrengths: childGameResults?.strengths ?? null,
            childGameSuggestedActivities: childGameResults?.suggested_activities ?? null,
          }),
          response_json_schema: {
            type: 'object',
            properties: {
              recommendations: {
                type: 'array',
                items: { type: 'string' },
                minItems: 5,
                maxItems: 5,
              },
            },
          },
        },
        write_back: {
          collection: 'growth_areas',
          filter: { area_id: area.id },
          field: 'pending_recommendations',
        },
      });
    } catch (err) {
      console.error('[GrowthAreasActivityGreatInsights] Failed to enqueue recommendations:', err);
      toast.error('Could not generate recommendations. Please try again.');
    }
  }, [
    area,
    childId,
    childName,
    childAge,
    childGender,
    interactiveAnswers,
    childGameResults,
    jobEnqueue,
  ]);

  const isGenerating = job.isLoading;
  const isError = status === 'error' || job.isFailed;

  if (isLoadingAuth || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          {...SPINNER}
          className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
        />
      </div>
    );
  }

  if (isError || !area) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
        <p className="text-muted-foreground">Could not load insights. Please try again.</p>
        <Button
          onClick={() => navigate(childId ? `/GrowthAreas/${childId}` : '/Home')}
          className="btn-primary rounded-2xl px-8"
        >
          Back to Growth Areas
        </Button>
      </div>
    );
  }

  const Icon = area.icon;

  return (
    <div className="min-h-screen bg-background">
      {/* Area header */}
      <div className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${area.color}`}
            >
              <Icon className="h-5 w-5 text-white" />
            </div>
            <p className="text-sm font-semibold text-foreground">{area.name} — Great Insights</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center"
        >
          <div
            className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br ${area.color}`}
          >
            <Icon className="h-10 w-10 text-white" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-foreground">Great Insights!</h2>
          <p className="text-muted-foreground">
            Here's what we learned about {childName}'s {area.name}
          </p>
        </motion.div>

        {/* Q&A summary */}
        {(() => {
          const questions: Question[] = AREA_QUESTIONS[area.id] ?? [];
          const answered = questions.filter((q) => interactiveAnswers[q.id]);
          if (answered.length === 0) return null;
          return (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="space-y-3 rounded-2xl border border-border bg-card p-6"
            >
              {answered.map((q, i) => {
                const answerVal = interactiveAnswers[q.id];
                return (
                  <motion.div
                    key={q.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.7, delay: 0.4 + i * 0.15 }}
                    className="border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <p className="mb-1 text-xs text-muted-foreground">
                      {q.question.replace(/\{name\}/g, childName || 'your child')}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {typeof answerVal === 'string' ? answerVal : ''}
                    </p>
                  </motion.div>
                );
              })}
            </motion.div>
          );
        })()}

        {/* Child game results */}
        {childGameResults && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="space-y-4 rounded-2xl border border-success/20 bg-card p-6"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-success to-primary-dark">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <h3 className="font-bold text-foreground">Recommendations for {childName}</h3>
            </div>

            {childGameResults.summary && (
              <div className="rounded-xl bg-surface-elevated p-4">
                <h4 className="mb-2 font-semibold text-foreground">What This Reveals</h4>
                <p className="text-sm text-muted-foreground">{childGameResults.summary}</p>
              </div>
            )}

            {Array.isArray(childGameResults.suggested_activities) &&
              childGameResults.suggested_activities.length > 0 && (
                <div className="rounded-xl bg-surface-elevated p-4">
                  <h4 className="mb-2 font-semibold text-foreground">Suggested Activities</h4>
                  <ul className="space-y-2">
                    {childGameResults.suggested_activities.map((act) => (
                      <li
                        key={act}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                      >
                        <span className="mt-0.5 text-success">✓</span>
                        <span>{act}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {Array.isArray(childGameResults.strengths) && childGameResults.strengths.length > 0 && (
              <div className="rounded-xl bg-surface-elevated p-4">
                <h4 className="mb-2 font-semibold text-foreground">Strengths to Encourage</h4>
                <ul className="space-y-2">
                  {childGameResults.strengths.map((s) => (
                    <li key={s} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-0.5 text-success">★</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}

        {/* 3-month recommendations */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-success" />
            <h3 className="font-semibold text-foreground">
              3-Month Recommendations for {area.name}
            </h3>
          </div>

          {/* Button state */}
          {status === 'idle' && !isGenerating && (
            <Button
              onClick={() => {
                void generateRecommendations();
              }}
              className="h-11 w-full rounded-2xl bg-gradient-to-r from-success to-primary-dark text-base text-white"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Recommendations
            </Button>
          )}

          {/* Generating spinner */}
          {isGenerating && (
            <div className="flex flex-col items-center justify-center gap-5 py-10">
              <div className="relative h-16 w-16">
                <div className="absolute inset-0 rounded-full border-4 border-success/20" />
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-success" />
                <div
                  className="absolute inset-2 animate-spin rounded-full border-4 border-transparent border-t-primary"
                  style={{ animationDuration: '0.7s', animationDirection: 'reverse' }}
                />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-sm font-semibold text-foreground">Building your 3-Month Plan</p>
                <p className="text-xs text-muted-foreground">
                  Personalising recommendations for {childName}…
                </p>
              </div>
            </div>
          )}

          {/* Ready — show list */}
          {Array.isArray(recommendations) && recommendations.length > 0 && (
            <div className="space-y-3">
              {recommendations.map((rec, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="flex items-start gap-3 rounded-xl bg-surface-input p-3"
                >
                  <div
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${area.color}`}
                  >
                    <span className="text-xs font-bold text-white">{i + 1}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground">{rec}</p>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Navigation */}
        <PageActions
          className="pt-4"
          left={
            <Button
              size="xl"
              variant="outline"
              onClick={() => navigate(`/GrowthAreas/${childId}`)}
              className="btn-secondary w-full rounded-2xl sm:w-auto"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          }
          center={<StartOverButton childId={childId} className="w-full sm:w-auto" />}
          right={
            <Button
              size="xl"
              onClick={() => navigate(`/GrowthAreas/${childId}`)}
              className={`w-full rounded-2xl bg-gradient-to-r ${area.color} px-10 text-white sm:w-auto`}
            >
              Done
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          }
        />
      </div>
    </div>
  );
}
