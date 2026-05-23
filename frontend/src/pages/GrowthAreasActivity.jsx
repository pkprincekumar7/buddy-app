import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { areaByUrlName, AREA_QUESTIONS } from '@/lib/growthAreaData';
import { SPINNER } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';

export default function GrowthAreasActivity() {
  const navigate = useNavigate();
  const { childId, activity } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();

  const area = areaByUrlName(activity);
  const questions = area ? (AREA_QUESTIONS[area.id] || []) : [];
  // q param is 1-indexed; clamp to valid range
  const qRaw = parseInt(searchParams.get('q') || '1', 10);
  const qIndex = Math.max(0, Math.min(qRaw - 1, questions.length - 1));

  const [childName, setChildName] = useState('');
  const [answers, setAnswers] = useState({});
  const answersRef = useRef(answers);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) { navigate('/Onboarding', { replace: true }); return; }
    if (!childId) { navigate('/Home', { replace: true }); return; }
    if (!area) { navigate(`/GrowthAreas/${childId}`, { replace: true }); return; }
    let cancelled = false;

    (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) { navigate('/Home', { replace: true }); return; }

        setChildName(child.name || '');

        const completedData = await api.completedGrowthAreas.list(child.id);
        if (cancelled) return;
        const allDocs = Array.isArray(completedData?.areas) ? completedData.areas : [];
        const areaDoc =
          allDocs.find((a) => a.area_id === area.id && a.status === 'in_progress') ||
          allDocs.find((a) => a.area_id === area.id) ||
          {};

        const savedAnswers =
          areaDoc.interactive_answers && typeof areaDoc.interactive_answers === 'object'
            ? areaDoc.interactive_answers
            : {};
        setAnswers(savedAnswers);

        // If no explicit q param was in the URL, jump to the first unanswered question
        if (!searchParams.get('q')) {
          const firstUnanswered = questions.findIndex(
            (q) => !savedAnswers[q.id] || String(savedAnswers[q.id]).trim() === '',
          );
          // +1 sentinel when all answered so the > check below fires correctly
          const startQ = firstUnanswered === -1 ? questions.length + 1 : firstUnanswered + 1;
          if (startQ > questions.length) {
            // All answered — go straight to Game
            navigate(`/GrowthAreas/${childId}/Activity/${activity}/Game`, { replace: true });
            return;
          }
          setSearchParams({ q: String(startQ) }, { replace: true });
        }

        const cq = questions[qIndex];
        if (cq && savedAnswers[cq.id]) {
          setCurrentAnswer(String(savedAnswers[cq.id]));
        }
      } catch (err) {
        console.warn('[GrowthAreasActivity] Load failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => { cancelled = true; };
  }, [isLoadingAuth, isAuthenticated, childId, activity, navigate, setSearchParams]);

  // Keep ref in sync so the qIndex effect can read the latest answers without depending on them.
  useEffect(() => { answersRef.current = answers; }, [answers]);

  // Reset current answer when question index changes.
  // Reads answers via ref to avoid firing on every keystroke.
  useEffect(() => {
    const cq = questions[qIndex];
    if (cq) {
      setCurrentAnswer(answersRef.current[cq.id] ? String(answersRef.current[cq.id]) : '');
    }
  }, [qIndex, questions]);

  const saveProgress = useCallback(async (updatedAnswers, nextStep) => {
    if (!childId || !area) return;
    try {
      await api.completedGrowthAreas.append(childId, {
        area_id: area.id,
        area_name: area.name,
        area_color: area.color,
        answers: updatedAnswers,
        status: 'in_progress',
        step: nextStep,
        interactive_step: qIndex,
        interactive_answers: updatedAnswers,
        interactive_draft: null,
      });
    } catch (err) {
      console.warn('[GrowthAreasActivity] Save failed:', err);
    }
  }, [childId, area, qIndex]);

  const handleAnswer = useCallback((answer) => {
    if (!area) return;
    const cq = questions[qIndex];
    if (!cq) return;

    const updatedAnswers = { ...answers, [cq.id]: answer };
    setAnswers(updatedAnswers);

    const isLast = qIndex >= questions.length - 1;
    const nextStep = isLast ? 'activity_summary' : 'interactive_activity';

    // Navigate immediately — smooth, no waiting for the network.
    if (isLast) {
      navigate(`/GrowthAreas/${childId}/Activity/${activity}/Game`);
    } else {
      setSearchParams({ q: String(qIndex + 2) });
    }

    // Save in the background — does not block navigation.
    saveProgress(updatedAnswers, nextStep);
  }, [area, questions, qIndex, answers, saveProgress, navigate, childId, activity, setSearchParams]);

  const handleBack = useCallback(() => {
    if (qIndex === 0) {
      navigate(`/GrowthAreas/${childId}`);
    } else {
      setSearchParams({ q: String(qIndex) });
    }
  }, [qIndex, navigate, setSearchParams]);

  if (isLoadingAuth || !hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div {...SPINNER} className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  if (!area || questions.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
        <p className="text-slate-400">Area not found.</p>
        <Button onClick={() => navigate(childId ? `/GrowthAreas/${childId}` : '/Home')} className="btn-primary rounded-2xl px-8">Back</Button>
      </div>
    );
  }

  const currentQuestion = questions[qIndex];
  const Icon = area.icon;
  const questionText = currentQuestion.question.replace(/\{name\}/g, childName || 'your child');
  const progress = ((qIndex + 1) / questions.length) * 100;

  return (
    <div className="min-h-screen bg-background">
      {/* Area header */}
      <div className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${area.color}`}>
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{area.name}</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${area.color} transition-all duration-300`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {qIndex + 1} / {questions.length}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={qIndex}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            {/* Question */}
            <div className="rounded-2xl border border-white/10 bg-card p-6">
              <p className="text-lg font-semibold leading-relaxed text-white">
                {questionText}
              </p>
            </div>

            {/* Answer input */}
            {currentQuestion.type === 'choice' ? (
              <div className="space-y-3">
                {currentQuestion.options.map((option) => (
                  <button
                    key={option}
                    onClick={() => setCurrentAnswer(option)}
                    className={`w-full rounded-2xl border px-5 py-4 text-left text-sm font-medium transition-all hover:scale-[1.01] ${
                      currentAnswer === option
                        ? `border-transparent bg-gradient-to-r ${area.color} text-white`
                        : 'border-edge-faint bg-card text-slate-300 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <TextareaWithVoice
                value={currentAnswer}
                onChange={(e) => setCurrentAnswer(e.target.value)}
                placeholder={currentQuestion.placeholder || ''}
                rows={3}
                className="w-full rounded-2xl border border-edge-faint bg-card px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 resize-none"
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <PageActions
          className="mt-10"
          left={
            <Button
              variant="outline"
              onClick={handleBack}
              className="btn-secondary h-12 w-full rounded-2xl px-6 sm:w-auto"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          }
          center={<StartOverButton childId={childId} className="w-full sm:w-auto" />}
          right={
            <Button
              onClick={() => handleAnswer(currentAnswer)}
              disabled={!currentAnswer.trim()}
              className={`h-12 w-full rounded-2xl bg-gradient-to-r ${area.color} px-8 text-white disabled:opacity-50 sm:w-auto`}
            >
              {qIndex >= questions.length - 1 ? 'Finish' : 'Next'}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          }
        />
      </div>
    </div>
  );
}
