import { useEffect, useState, useCallback } from 'react';
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
import { SPINNER } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';

export default function GrowthAreasActivityGreatInsights() {
  const navigate = useNavigate();
  const { childId, activity } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();

  const area = areaByUrlName(activity ?? '');

  type GameResults = { summary?: string; strengths?: string[]; suggested_activities?: string[] };
  const [childName, setChildName] = useState('');
  const [recommendations, setRecommendations] = useState<string[] | null>(null);
  const [interactiveAnswers, setInteractiveAnswers] = useState<Record<string, unknown>>({});
  const [childGameResults, setChildGameResults] = useState<GameResults | null>(null);
  // loading → initial DB fetch | idle → no cached recs, waiting for button | generating → LLM running | ready → recs available | error → load failed
  const [status, setStatus] = useState('loading');

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
    setStatus('generating');

    const questions: Question[] = AREA_QUESTIONS[area.id] ?? [];
    const qaContext = questions
      .filter((q) => interactiveAnswers[q.id])
      .map(
        (q) =>
          `Q: ${q.question.replace(/\{name\}/g, childName || 'the child')}\nA: ${String(interactiveAnswers[q.id])}`,
      )
      .join('\n\n');

    const childContext = childGameResults
      ? `\n\nChild's activity responses:\nSummary: ${childGameResults.summary ?? ''}\nStrengths: ${(childGameResults.strengths ?? []).join(', ')}\nSuggested: ${(childGameResults.suggested_activities ?? []).join(', ')}`
      : '';

    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Based on the following parent responses about "${childName || 'the child'}" in the growth area "${area.name}", generate 5 practical 3-month recommendations.\n\nParent responses:\n${qaContext}${childContext}\n\nReturn ONLY a JSON object with a "recommendations" array of 5 short, actionable bullet points (1-2 sentences each) specific to the "${area.name}" growth area.`,
        response_json_schema: {
          type: 'object',
          properties: {
            recommendations: { type: 'array', items: { type: 'string' } },
          },
        },
      });

      const resultRecord = result as Record<string, unknown> | null;
      const list: string[] = Array.isArray(resultRecord?.['recommendations'])
        ? (resultRecord['recommendations'] as string[])
        : [];
      setRecommendations(list);

      await api.completedGrowthAreas.append(childId, {
        area_id: area.id,
        area_name: area.name,
        area_color: area.color,
        answers: interactiveAnswers,
        status: 'completed',
        step: 'activity_summary',
        ai_three_month_recommendations: list,
        interactive_answers: interactiveAnswers,
      });

      setStatus('ready');
    } catch (err) {
      console.error('[GrowthAreasActivityGreatInsights] LLM failed:', err);
      toast.error('Could not generate recommendations. Please try again.');
      setStatus('idle');
    }
  }, [area, childId, childName, interactiveAnswers, childGameResults]);

  if (isLoadingAuth || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          {...SPINNER}
          className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent"
        />
      </div>
    );
  }

  if (status === 'error' || !area) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
        <p className="text-slate-400">Could not load insights. Please try again.</p>
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
            <p className="text-sm font-semibold text-white">{area.name} — Great Insights</p>
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
          <h2 className="mb-2 text-2xl font-bold text-white">Great Insights!</h2>
          <p className="text-slate-400">
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
              className="space-y-3 rounded-2xl border border-white/10 bg-card p-6"
            >
              {answered.map((q, i) => {
                const answerVal = interactiveAnswers[q.id];
                return (
                  <motion.div
                    key={q.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.7, delay: 0.4 + i * 0.15 }}
                    className="border-b border-white/5 pb-3 last:border-0 last:pb-0"
                  >
                    <p className="mb-1 text-xs text-slate-500">
                      {q.question.replace(/\{name\}/g, childName || 'your child')}
                    </p>
                    <p className="text-sm font-medium text-white">
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
            className="space-y-4 rounded-2xl border border-emerald-500/20 bg-card p-6"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <h3 className="font-bold text-white">Recommendations for {childName}</h3>
            </div>

            {childGameResults.summary && (
              <div className="rounded-xl bg-surface-elevated p-4">
                <h4 className="mb-2 font-semibold text-white">What This Reveals</h4>
                <p className="text-sm text-slate-400">{childGameResults.summary}</p>
              </div>
            )}

            {Array.isArray(childGameResults.suggested_activities) &&
              childGameResults.suggested_activities.length > 0 && (
                <div className="rounded-xl bg-surface-elevated p-4">
                  <h4 className="mb-2 font-semibold text-white">Suggested Activities</h4>
                  <ul className="space-y-2">
                    {childGameResults.suggested_activities.map((act) => (
                      <li key={act} className="flex items-start gap-2 text-sm text-slate-400">
                        <span className="mt-0.5 text-emerald-500">✓</span>
                        <span>{act}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {Array.isArray(childGameResults.strengths) && childGameResults.strengths.length > 0 && (
              <div className="rounded-xl bg-surface-elevated p-4">
                <h4 className="mb-2 font-semibold text-white">Strengths to Encourage</h4>
                <ul className="space-y-2">
                  {childGameResults.strengths.map((s) => (
                    <li key={s} className="flex items-start gap-2 text-sm text-slate-400">
                      <span className="mt-0.5 text-emerald-500">★</span>
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
          className="rounded-2xl border border-white/10 bg-card p-6"
        >
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-emerald-500" />
            <h3 className="font-semibold text-white">3-Month Recommendations for {area.name}</h3>
          </div>

          {/* Button state */}
          {status === 'idle' && (
            <Button
              onClick={() => {
                void generateRecommendations();
              }}
              className="h-11 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Recommendations
            </Button>
          )}

          {/* Generating spinner */}
          {status === 'generating' && (
            <div className="flex flex-col items-center justify-center gap-5 py-10">
              <div className="relative h-16 w-16">
                <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20" />
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-emerald-500" />
                <div
                  className="absolute inset-2 animate-spin rounded-full border-4 border-transparent border-t-teal-400"
                  style={{ animationDuration: '0.7s', animationDirection: 'reverse' }}
                />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-sm font-semibold text-white">Building your 3-Month Plan</p>
                <p className="text-xs text-slate-500">
                  Personalising recommendations for {childName}…
                </p>
              </div>
            </div>
          )}

          {/* Ready — show list */}
          {status === 'ready' && Array.isArray(recommendations) && recommendations.length > 0 && (
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
                  <p className="text-sm leading-relaxed text-slate-300">{rec}</p>
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
              variant="outline"
              onClick={() => navigate(`/GrowthAreas/${childId}`)}
              className="btn-secondary h-12 w-full rounded-2xl px-6 sm:w-auto"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          }
          center={<StartOverButton childId={childId} className="w-full sm:w-auto" />}
          right={
            <Button
              onClick={() => navigate(`/GrowthAreas/${childId}`)}
              className={`h-12 w-full rounded-2xl bg-gradient-to-r ${area.color} px-10 text-white sm:w-auto`}
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
