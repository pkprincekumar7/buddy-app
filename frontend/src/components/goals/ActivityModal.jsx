import { useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Trophy, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { api } from '@/api/client';
import { unwrapLLM } from '@/lib/llmUtils';
import { activityQuestionsSchema } from '@/lib/llmSchemas';
import {
  buildActivityQuestionsPrompt,
  buildActivityScorePrompt,
  buildActivityNotePrompt,
  buildProgressComparisonPrompt,
} from '@/lib/prompts';

// ── reducer ──────────────────────────────────────────────────────────────────

const ACTIVITY_STEPS = {
  LOADING:   'loading',
  QUESTIONS: 'questions',
  ANALYZING: 'analyzing',
  COMPLETE:  'complete',
};

const initialActivityState = {
  step: ACTIVITY_STEPS.LOADING,
  questions: [],
  currentQuestionIndex: 0,
  direction: 1,           // 1 = forward, -1 = backward
  responses: {},
  currentAnswer: '',
  aiScore: null,
  aiNote: null,
  aiFeedback: '',
  parentFeedback: '',
  isSaving: false,
};

function activityReducer(state, action) {
  switch (action.type) {
    case 'QUESTIONS_LOADED':
      return { ...state, questions: action.questions, step: ACTIVITY_STEPS.QUESTIONS };
    case 'SET_CURRENT_ANSWER':
      return { ...state, currentAnswer: action.value };
    case 'ADVANCE_QUESTION':
      return {
        ...state,
        direction: 1,
        currentQuestionIndex: action.index,
        responses: action.responses,
        currentAnswer: '',
      };
    case 'GO_BACK_QUESTION':
      return {
        ...state,
        direction: -1,
        currentQuestionIndex: action.index,
        currentAnswer: action.savedAnswer,
      };
    case 'SET_STEP':
      return { ...state, step: action.step };
    case 'ANALYSIS_COMPLETE':
      return {
        ...state,
        step: ACTIVITY_STEPS.COMPLETE,
        aiScore: action.aiScore ?? null,
        aiNote: action.aiNote ?? null,
        aiFeedback: action.aiFeedback,
      };
    case 'SET_PARENT_FEEDBACK':
      return { ...state, parentFeedback: action.value };
    case 'SET_SAVING':
      return { ...state, isSaving: action.value };
    default:
      return state;
  }
}

// ── component ─────────────────────────────────────────────────────────────────

const CHOICE_FEEDBACK_DELAY_MS = 250;

const buildFallbackQuestions = (activityTitle) => [
  { id: 1, type: 'choice', question: `What part of "${activityTitle}" are you most excited about?`, options: ['Learning something new', 'Having fun with it', 'Showing my skills', 'Doing it with others'], labels: [] },
  { id: 2, type: 'text', question: 'What do you think will be the most exciting part of this activity?', options: [], labels: [] },
  { id: 3, type: 'scale', question: 'How excited are you about this activity?', options: [], labels: ['Not excited', 'Super excited'] },
  { id: 4, type: 'text', question: 'What do you hope to learn or achieve from this?', options: [], labels: [] }
];

export default function ActivityModal({ activity, originalActivity, childName, onClose, onComplete }) {
  const isScorableActivity = activity.scorable !== false;
  const [state, dispatch] = useReducer(activityReducer, initialActivityState);
  const {
    step, questions, currentQuestionIndex, direction,
    responses, currentAnswer, aiScore, aiNote, aiFeedback,
    parentFeedback, isSaving,
  } = state;

  const choiceTimeoutRef = useRef(null);

  const generateQuestions = useCallback(async () => {
    const fallbackQuestions = buildFallbackQuestions(activity.title);
    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: buildActivityQuestionsPrompt({ title: activity.title, objective: activity.objective, childName }),
        response_json_schema: activityQuestionsSchema(),
      });
      const raw = result.properties?.questions ?? result.questions;
      dispatch({ type: 'QUESTIONS_LOADED', questions: raw?.length ? raw : fallbackQuestions });
    } catch (err) {
      console.warn('[ActivityModal] Question generation failed, using fallback:', err);
      dispatch({ type: 'QUESTIONS_LOADED', questions: fallbackQuestions });
    }
  }, [activity.title, activity.objective, childName]);

  useEffect(() => {
    generateQuestions();
    return () => clearTimeout(choiceTimeoutRef.current);
  }, [generateQuestions]);

  const analyzeResponses = useCallback(async (allResponses) => {
    dispatch({ type: 'SET_STEP', step: ACTIVITY_STEPS.ANALYZING });
    try {
      const answersText = Object.values(allResponses)
        .map((r) => {
          const typeHint = r.type === 'scale' ? ' (rated on a scale of 1–5)' : '';
          return `Q: ${r.question}\nA: ${r.answer}${typeHint}`;
        })
        .join('\n\n');

      if (isScorableActivity) {
        const result = await api.integrations.Core.InvokeLLM({
          prompt: buildActivityScorePrompt({ title: activity.title, objective: activity.objective, answersText }),
          response_json_schema: {
            type: 'object',
            properties: {
              score: { type: 'number' },
              feedback: { type: 'string' },
            },
          },
        });
        const data = result.properties ?? result;
        dispatch({
          type: 'ANALYSIS_COMPLETE',
          aiScore: unwrapLLM(data.score) ?? 7,
          aiFeedback: unwrapLLM(data.feedback) || 'Great job completing this activity!',
        });
      } else {
        const result = await api.integrations.Core.InvokeLLM({
          prompt: buildActivityNotePrompt({ title: activity.title, objective: activity.objective, answersText }),
          response_json_schema: {
            type: 'object',
            properties: {
              note: { type: 'string' },
              feedback: { type: 'string' },
            },
          },
        });
        const data = result.properties ?? result;
        dispatch({
          type: 'ANALYSIS_COMPLETE',
          aiNote: unwrapLLM(data.note) ?? 'Great effort today!',
          aiFeedback: unwrapLLM(data.feedback) || 'Great job completing this activity!',
        });
      }
    } catch (err) {
      console.warn('[ActivityModal] AI analysis failed, using defaults:', err);
      dispatch({
        type: 'ANALYSIS_COMPLETE',
        aiScore: isScorableActivity ? 7 : null,
        aiNote: isScorableActivity ? null : 'Great effort today!',
        aiFeedback: 'Great job completing this activity with enthusiasm!',
      });
    }
  }, [dispatch, activity.title, activity.objective, isScorableActivity]);

  const advanceOrAnalyze = useCallback((newResponses, questionIdx) => {
    if (questionIdx < questions.length - 1) {
      dispatch({ type: 'ADVANCE_QUESTION', index: questionIdx + 1, responses: newResponses });
    } else {
      analyzeResponses(newResponses);
    }
  }, [questions.length, dispatch, analyzeResponses]);

  const handleAnswerQuestion = useCallback(() => {
    const question = questions[currentQuestionIndex];
    const newResponses = {
      ...responses,
      [question.id]: { question: question.question, answer: currentAnswer, type: question.type }
    };
    advanceOrAnalyze(newResponses, currentQuestionIndex);
  }, [questions, currentQuestionIndex, responses, currentAnswer, advanceOrAnalyze]);

  const handleChoiceSelect = useCallback((option) => {
    clearTimeout(choiceTimeoutRef.current);
    const question = questions[currentQuestionIndex];
    const idx = currentQuestionIndex;
    const newResponses = {
      ...responses,
      [question.id]: { question: question.question, answer: option, type: 'choice' }
    };
    dispatch({ type: 'SET_CURRENT_ANSWER', value: option });
    choiceTimeoutRef.current = setTimeout(() => {
      advanceOrAnalyze(newResponses, idx);
    }, CHOICE_FEEDBACK_DELAY_MS);
  }, [questions, currentQuestionIndex, responses, dispatch, advanceOrAnalyze]);

  const handleGoBack = useCallback(() => {
    clearTimeout(choiceTimeoutRef.current);
    const prevIdx = currentQuestionIndex - 1;
    const prevQuestion = questions[prevIdx];
    const savedAnswer = responses[prevQuestion?.id]?.answer || '';
    dispatch({ type: 'GO_BACK_QUESTION', index: prevIdx, savedAnswer });
  }, [currentQuestionIndex, questions, responses, dispatch]);

  const handleSaveAndContinue = useCallback(async () => {
    dispatch({ type: 'SET_SAVING', value: true });
    let progressObservation = null;

    try {
      if (!isScorableActivity && originalActivity?.completed) {
        try {
          const result = await api.integrations.Core.InvokeLLM({
            prompt: buildProgressComparisonPrompt({
              originalTitle: originalActivity.title,
              originalNote: originalActivity.note,
              originalAiFeedback: originalActivity.ai_feedback,
              originalParentFeedback: originalActivity.parent_feedback,
              followupTitle: activity.title,
              followupNote: aiNote,
              followupAiFeedback: aiFeedback,
              followupParentFeedback: parentFeedback,
            }),
            response_json_schema: {
              type: 'object',
              properties: {
                progress_observation: { type: 'string' },
              },
            },
          });
          const data = result.properties ?? result;
          progressObservation = unwrapLLM(data.progress_observation) ?? 'No Improvement';
        } catch (err) {
          console.warn('[ActivityModal] Progress comparison failed, defaulting:', err);
          progressObservation = 'No Improvement';
        }
      }

      await onComplete({
        score: isScorableActivity ? aiScore : null,
        note: isScorableActivity ? null : aiNote,
        progress_observation: progressObservation,
        ai_feedback: aiFeedback,
        parent_feedback: parentFeedback,
      });
    } finally {
      dispatch({ type: 'SET_SAVING', value: false });
    }
  }, [dispatch, isScorableActivity, originalActivity, activity.title, aiNote, aiFeedback, parentFeedback, aiScore, onComplete]);

  const currentQuestion = questions[currentQuestionIndex];
  const progress = questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={activity.title}
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16, transition: { duration: 0.25, ease: 'easeIn' } }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="bg-card rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border-edge"
      >
        {/* Header */}
        <div className="p-6 bg-gradient-to-br from-teal-400 to-emerald-500 rounded-t-3xl relative">
          <button
            onClick={onClose}
            aria-label="Close activity"
            className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>

          <div className="flex items-start gap-4 mb-4 pr-10">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0 backdrop-blur-sm">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white leading-tight">{activity.title}</h2>
              <p className="text-white/90 text-sm mt-0.5 leading-snug">{activity.objective}</p>
            </div>
          </div>

          {step === ACTIVITY_STEPS.QUESTIONS && questions.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-white/90 text-sm">
                <span>Question {currentQuestionIndex + 1} of {questions.length}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-white rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.45 }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {step === ACTIVITY_STEPS.LOADING && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-16 flex flex-col items-center gap-4"
                aria-live="polite"
                aria-busy="true"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full"
                  aria-hidden="true"
                />
                <p className="text-slate-400 font-medium">Preparing activity...</p>
              </motion.div>
            )}

            {step === ACTIVITY_STEPS.QUESTIONS && currentQuestion && (
              <motion.div
                key={`q-${currentQuestionIndex}`}
                initial={{ opacity: 0, x: direction * 48 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -48, transition: { duration: 0.3, ease: 'easeIn' } }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="py-4"
              >
                <h3 className="text-lg font-bold text-white mb-6 leading-snug">
                  {currentQuestion.question}
                </h3>

                {currentQuestion.type === 'choice' && (
                  <div className="space-y-3">
                    {currentQuestion.options?.map((option) => (
                      <motion.button
                        key={option}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleChoiceSelect(option)}
                        className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                          currentAnswer === option
                            ? 'border-teal-500 bg-teal-500/10'
                            : 'border-c-edge hover:border-c-bright bg-surface-input'
                        }`}
                      >
                        <span className="font-medium text-slate-300">{option}</span>
                      </motion.button>
                    ))}
                    {currentQuestionIndex > 0 && (
                      <button
                        onClick={handleGoBack}
                        className="mt-2 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" /> Previous
                      </button>
                    )}
                  </div>
                )}

                {currentQuestion.type === 'text' && (
                  <div className="space-y-4">
                    <TextareaWithVoice
                      value={currentAnswer}
                      onChange={(e) => dispatch({ type: 'SET_CURRENT_ANSWER', value: e.target.value })}
                      placeholder="Type or speak your answer..."
                      className="min-h-[120px] rounded-2xl resize-none"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      {currentQuestionIndex > 0 ? (
                        <Button
                          variant="outline"
                          onClick={handleGoBack}
                          className="h-12 rounded-2xl border-edge-strong text-slate-400 bg-transparent hover:bg-subtle"
                        >
                          <ChevronLeft className="w-5 h-5 mr-1" /> Previous
                        </Button>
                      ) : (
                        <div />
                      )}
                      <Button
                        onClick={handleAnswerQuestion}
                        disabled={!currentAnswer.trim()}
                        className="h-12 rounded-2xl bg-teal-500 hover:bg-teal-600 text-white font-semibold disabled:opacity-50"
                      >
                        Next <ChevronRight className="w-5 h-5 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}

                {currentQuestion.type === 'scale' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center gap-2">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <motion.button
                          key={value}
                          whileTap={{ scale: 0.92 }}
                          onClick={() => dispatch({ type: 'SET_CURRENT_ANSWER', value: value.toString() })}
                          className={`flex-1 h-16 rounded-2xl font-bold text-xl transition-all ${
                            currentAnswer === value.toString()
                              ? 'bg-teal-500 text-white shadow-lg'
                              : 'bg-ghost-light text-slate-400 hover:bg-ghost-strong'
                          }`}
                        >
                          {value}
                        </motion.button>
                      ))}
                    </div>
                    {currentQuestion.labels?.length > 0 && (
                      <div className="flex justify-between text-sm text-slate-500 px-1">
                        <span>{currentQuestion.labels[0]}</span>
                        <span>{currentQuestion.labels[1]}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {currentQuestionIndex > 0 ? (
                        <Button
                          variant="outline"
                          onClick={handleGoBack}
                          className="h-12 rounded-2xl border-edge-strong text-slate-400 bg-transparent hover:bg-subtle"
                        >
                          <ChevronLeft className="w-5 h-5 mr-1" /> Previous
                        </Button>
                      ) : (
                        <div />
                      )}
                      <Button
                        onClick={handleAnswerQuestion}
                        disabled={!currentAnswer}
                        className={`h-12 rounded-2xl font-semibold transition-all ${
                          currentAnswer
                            ? 'bg-teal-500 hover:bg-teal-600 text-white'
                            : 'bg-teal-200 text-white cursor-not-allowed'
                        }`}
                      >
                        Next <ChevronRight className="w-5 h-5 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {step === ACTIVITY_STEPS.ANALYZING && (
              <motion.div
                key="analyzing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-16 flex flex-col items-center gap-4"
                aria-live="polite"
                aria-busy="true"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full"
                  aria-hidden="true"
                />
                <p className="text-white font-semibold text-lg">Analysing the response...</p>
                <p className="text-slate-500 text-sm">Just a moment</p>
              </motion.div>
            )}

            {step === ACTIVITY_STEPS.COMPLETE && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="py-4 space-y-5"
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Trophy className="w-8 h-8 text-amber-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Activity Complete! <span aria-hidden="true">🎉</span></h3>
                  <p className="text-slate-400">Great work, {childName || 'there'}!</p>
                </div>

                <div className="bg-emerald-500/[0.08] border border-emerald-500/20 rounded-2xl p-4 flex gap-4 items-start">
                  <div className="flex-shrink-0">
                    {isScorableActivity ? (
                      <>
                        <p className="text-xs font-semibold text-emerald-400 mb-0.5">AI Score</p>
                        <p className="text-3xl font-bold text-emerald-300 leading-none">
                          {aiScore}
                          <span className="text-base font-normal text-emerald-500">/10</span>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-emerald-400 mb-0.5">Note</p>
                        <p className="text-base font-bold text-emerald-300 leading-snug max-w-[120px]">
                          {aiNote}
                        </p>
                      </>
                    )}
                  </div>
                  <p className="text-emerald-300 text-sm mt-1"><span aria-hidden="true">✅</span> {aiFeedback}</p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Parent Feedback{' '}
                    <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <TextareaWithVoice
                    value={parentFeedback}
                    onChange={(e) => dispatch({ type: 'SET_PARENT_FEEDBACK', value: e.target.value })}
                    placeholder="Share your observations about your child's performance..."
                    className="min-h-[100px] rounded-2xl resize-none"
                  />
                </div>

                <Button
                  onClick={handleSaveAndContinue}
                  disabled={isSaving}
                  className="w-full h-12 rounded-2xl bg-teal-500 hover:bg-teal-600 text-white font-semibold"
                >
                  {isSaving ? 'Saving...' : <>Save &amp; Continue <span aria-hidden="true">🚀</span></>}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

ActivityModal.propTypes = {
  activity: PropTypes.shape({
    title: PropTypes.string.isRequired,
    objective: PropTypes.string,
    scorable: PropTypes.bool,
  }).isRequired,
  originalActivity: PropTypes.shape({
    title: PropTypes.string,
    note: PropTypes.string,
    ai_feedback: PropTypes.string,
    parent_feedback: PropTypes.string,
    completed: PropTypes.bool,
  }),
  childName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onComplete: PropTypes.func.isRequired,
};
