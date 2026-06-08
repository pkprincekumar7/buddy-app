import { useReducer, useEffect, useRef, useCallback } from 'react';
import type { ChangeEvent } from 'react';
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

// ── types ─────────────────────────────────────────────────────────────────────

interface ActivityQuestion {
  id: number | string;
  type: 'choice' | 'text' | 'scale';
  question: string;
  options?: string[];
  labels?: string[];
}

interface QuestionResponse {
  question: string;
  answer: string;
  type: string;
}

interface ActivityState {
  step: string;
  questions: ActivityQuestion[];
  currentQuestionIndex: number;
  direction: number;
  responses: Record<string | number, QuestionResponse>;
  currentAnswer: string;
  aiScore: number | null;
  aiNote: string | null;
  aiFeedback: string;
  whatChanged: string | null;
  whatLearned: string | null;
  recommendation: string | null;
  answersText: string;
  parentFeedback: string;
  confirmationStep: 'options' | 'feedback_form' | 'thank_you_acknowledge' | 'thank_you_feedback';
  isSaving: boolean;
}

type ActivityAction =
  | { type: 'QUESTIONS_LOADED'; questions: ActivityQuestion[] }
  | { type: 'SET_CURRENT_ANSWER'; value: string }
  | {
      type: 'ADVANCE_QUESTION';
      index: number;
      responses: Record<string | number, QuestionResponse>;
    }
  | { type: 'GO_BACK_QUESTION'; index: number; savedAnswer: string }
  | { type: 'SET_STEP'; step: string }
  | {
      type: 'ANALYSIS_COMPLETE';
      payload: {
        aiScore?: number | null;
        aiNote?: string | null;
        aiFeedback: string;
        whatChanged: string | null;
        whatLearned: string | null;
        recommendation: string | null;
        answersText: string;
      };
    }
  | { type: 'SET_CONFIRMATION_STEP'; value: ActivityState['confirmationStep'] }
  | { type: 'SET_PARENT_FEEDBACK'; value: string }
  | { type: 'SET_SAVING'; value: boolean };

// ── reducer ──────────────────────────────────────────────────────────────────

const ACTIVITY_STEPS = {
  LOADING: 'loading',
  QUESTIONS: 'questions',
  ANALYZING: 'analyzing',
  COMPLETE: 'complete',
};

const initialActivityState: ActivityState = {
  step: ACTIVITY_STEPS.LOADING,
  questions: [],
  currentQuestionIndex: 0,
  direction: 1,
  responses: {},
  currentAnswer: '',
  aiScore: null,
  aiNote: null,
  aiFeedback: '',
  whatChanged: null,
  whatLearned: null,
  recommendation: null,
  answersText: '',
  parentFeedback: '',
  confirmationStep: 'options',
  isSaving: false,
};

function activityReducer(state: ActivityState, action: ActivityAction): ActivityState {
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
        aiScore: action.payload.aiScore ?? null,
        aiNote: action.payload.aiNote ?? null,
        aiFeedback: action.payload.aiFeedback,
        whatChanged: action.payload.whatChanged,
        whatLearned: action.payload.whatLearned,
        recommendation: action.payload.recommendation,
        answersText: action.payload.answersText,
        confirmationStep: 'options',
      };
    case 'SET_CONFIRMATION_STEP':
      return { ...state, confirmationStep: action.value };
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

const buildFallbackQuestions = (activityTitle: string): ActivityQuestion[] => [
  {
    id: 1,
    type: 'choice',
    question: `What part of "${activityTitle}" are you most excited about?`,
    options: [
      'Learning something new',
      'Having fun with it',
      'Showing my skills',
      'Doing it with others',
    ],
    labels: [],
  },
  {
    id: 2,
    type: 'text',
    question: 'What do you think will be the most exciting part of this activity?',
    options: [],
    labels: [],
  },
  {
    id: 3,
    type: 'scale',
    question: 'How excited are you about this activity?',
    options: [],
    labels: ['Not excited', 'Super excited'],
  },
  {
    id: 4,
    type: 'text',
    question: 'What do you hope to learn or achieve from this?',
    options: [],
    labels: [],
  },
];

interface ActivityShape {
  title: string;
  objective?: string;
  scorable?: boolean;
  [key: string]: unknown;
}

interface OriginalActivityShape {
  title?: string;
  score?: number;
  note?: string;
  ai_feedback?: string;
  parent_feedback?: string;
  answers_text?: string;
  what_changed?: string;
  completed?: boolean;
  [key: string]: unknown;
}

interface ActivityModalProps {
  activity: ActivityShape;
  originalActivity?: OriginalActivityShape;
  childName?: string;
  childAge?: number | string | null;
  childGender?: string | null;
  goal?: string | null;
  impact?: string | null;
  onClose: () => void;
  onComplete: (result: Record<string, unknown>) => void | Promise<void>;
}

export default function ActivityModal({
  activity,
  originalActivity,
  childName,
  childAge,
  childGender,
  goal,
  impact,
  onClose,
  onComplete,
}: ActivityModalProps) {
  const isScorableActivity = activity.scorable !== false;
  const [state, dispatch] = useReducer(activityReducer, initialActivityState);
  const {
    step,
    questions,
    currentQuestionIndex,
    direction,
    responses,
    currentAnswer,
    aiScore,
    aiNote,
    aiFeedback,
    whatChanged,
    whatLearned,
    recommendation,
    answersText,
    parentFeedback,
    confirmationStep,
    isSaving,
  } = state;

  const choiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generateQuestions = useCallback(async () => {
    const fallbackQuestions = buildFallbackQuestions(activity.title);
    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: buildActivityQuestionsPrompt({
          title: activity.title,
          objective: activity.objective ?? '',
          childName,
          childAge,
          childGender,
          goal,
          impact,
        }),
        response_json_schema: activityQuestionsSchema(),
      });
      const raw = (result as Record<string, unknown>).questions;
      const rawArr = Array.isArray(raw) ? (raw as ActivityQuestion[]) : [];
      dispatch({ type: 'QUESTIONS_LOADED', questions: rawArr.length ? rawArr : fallbackQuestions });
    } catch (err) {
      console.warn('[ActivityModal] Question generation failed, using fallback:', err);
      dispatch({ type: 'QUESTIONS_LOADED', questions: fallbackQuestions });
    }
  }, [activity.title, activity.objective, childName, childAge, childGender, goal, impact]);

  useEffect(() => {
    void generateQuestions();
    return () => {
      if (choiceTimeoutRef.current !== null) clearTimeout(choiceTimeoutRef.current);
    };
  }, [generateQuestions]);

  const analyzeResponses = useCallback(
    async (allResponses: Record<string | number, QuestionResponse>) => {
      dispatch({ type: 'SET_STEP', step: ACTIVITY_STEPS.ANALYZING });
      try {
        const builtAnswersText = Object.values(allResponses)
          .map((r) => {
            const typeHint = r.type === 'scale' ? ' (rated on a scale of 1–5)' : '';
            return `Q: ${r.question}\nA: ${r.answer}${typeHint}`;
          })
          .join('\n\n');

        const isFollowUp = !!originalActivity?.completed;

        if (isScorableActivity) {
          const result = await api.integrations.Core.InvokeLLM({
            prompt: buildActivityScorePrompt({
              title: activity.title,
              objective: activity.objective ?? '',
              answersText: builtAnswersText,
              childName,
              childAge,
              childGender,
              isFollowUp,
              originalScore: isFollowUp ? (originalActivity?.score ?? null) : null,
              originalWhatChanged: isFollowUp ? (originalActivity?.what_changed ?? null) : null,
            }),
            response_json_schema: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                what_changed: { type: 'string' },
                what_learned: { type: 'string' },
                recommendation: { type: 'string' },
              },
            },
          });
          const data = result as Record<string, unknown>;
          const score = (unwrapLLM(data.score) as number | null | undefined) ?? 5;
          const wc = (unwrapLLM(data.what_changed) as string | undefined) ?? null;
          dispatch({
            type: 'ANALYSIS_COMPLETE',
            payload: {
              aiScore: score,
              aiFeedback: wc ?? 'Activity completed.',
              whatChanged: wc,
              whatLearned: (unwrapLLM(data.what_learned) as string | undefined) ?? null,
              recommendation: (unwrapLLM(data.recommendation) as string | undefined) ?? null,
              answersText: builtAnswersText,
            },
          });
        } else {
          const result = await api.integrations.Core.InvokeLLM({
            prompt: buildActivityNotePrompt({
              title: activity.title,
              objective: activity.objective ?? '',
              answersText: builtAnswersText,
              childName,
              childAge,
              childGender,
              isFollowUp,
              originalNote: isFollowUp ? (originalActivity?.note ?? null) : null,
              originalWhatChanged: isFollowUp ? (originalActivity?.what_changed ?? null) : null,
            }),
            response_json_schema: {
              type: 'object',
              properties: {
                note: { type: 'string' },
                what_changed: { type: 'string' },
                what_learned: { type: 'string' },
                recommendation: { type: 'string' },
              },
            },
          });
          const data = result as Record<string, unknown>;
          const wc = (unwrapLLM(data.what_changed) as string | undefined) ?? null;
          dispatch({
            type: 'ANALYSIS_COMPLETE',
            payload: {
              aiNote: (unwrapLLM(data.note) as string | undefined) ?? 'Activity completed.',
              aiFeedback: wc ?? 'Activity completed.',
              whatChanged: wc,
              whatLearned: (unwrapLLM(data.what_learned) as string | undefined) ?? null,
              recommendation: (unwrapLLM(data.recommendation) as string | undefined) ?? null,
              answersText: builtAnswersText,
            },
          });
        }
      } catch (err) {
        console.warn('[ActivityModal] AI analysis failed, using defaults:', err);
        dispatch({
          type: 'ANALYSIS_COMPLETE',
          payload: {
            aiScore: isScorableActivity ? 5 : null,
            aiNote: isScorableActivity ? null : 'Activity completed.',
            aiFeedback: 'Activity completed.',
            whatChanged: null,
            whatLearned: null,
            recommendation: null,
            answersText: '',
          },
        });
      }
    },
    [
      dispatch,
      activity.title,
      activity.objective,
      isScorableActivity,
      childName,
      childAge,
      childGender,
      originalActivity,
    ],
  );

  const advanceOrAnalyze = useCallback(
    (newResponses: Record<string | number, QuestionResponse>, questionIdx: number) => {
      if (questionIdx < questions.length - 1) {
        dispatch({ type: 'ADVANCE_QUESTION', index: questionIdx + 1, responses: newResponses });
      } else {
        void analyzeResponses(newResponses);
      }
    },
    [questions.length, dispatch, analyzeResponses],
  );

  const handleAnswerQuestion = useCallback(() => {
    const question = questions[currentQuestionIndex];
    if (!question) return;
    const newResponses = {
      ...responses,
      [question.id]: { question: question.question, answer: currentAnswer, type: question.type },
    };
    advanceOrAnalyze(newResponses, currentQuestionIndex);
  }, [questions, currentQuestionIndex, responses, currentAnswer, advanceOrAnalyze]);

  const handleChoiceSelect = useCallback(
    (option: string) => {
      if (choiceTimeoutRef.current !== null) clearTimeout(choiceTimeoutRef.current);
      const question = questions[currentQuestionIndex];
      if (!question) return;
      const idx = currentQuestionIndex;
      const newResponses = {
        ...responses,
        [question.id]: { question: question.question, answer: option, type: 'choice' },
      };
      dispatch({ type: 'SET_CURRENT_ANSWER', value: option });
      choiceTimeoutRef.current = setTimeout(() => {
        advanceOrAnalyze(newResponses, idx);
      }, CHOICE_FEEDBACK_DELAY_MS);
    },
    [questions, currentQuestionIndex, responses, dispatch, advanceOrAnalyze],
  );

  const handleGoBack = useCallback(() => {
    if (choiceTimeoutRef.current !== null) clearTimeout(choiceTimeoutRef.current);
    const prevIdx = currentQuestionIndex - 1;
    const prevQuestion = questions[prevIdx];
    const savedAnswer = prevQuestion ? (responses[prevQuestion.id]?.answer ?? '') : '';
    dispatch({ type: 'GO_BACK_QUESTION', index: prevIdx, savedAnswer });
  }, [currentQuestionIndex, questions, responses, dispatch]);

  const handleSaveAndContinue = useCallback(
    async (feedbackToSave: string) => {
      dispatch({ type: 'SET_SAVING', value: true });
      let progressObservation: string | null = null;

      try {
        if (!isScorableActivity && originalActivity?.completed) {
          try {
            const result = await api.integrations.Core.InvokeLLM({
              prompt: buildProgressComparisonPrompt({
                originalTitle: originalActivity.title ?? '',
                originalNote: originalActivity.note,
                originalAiFeedback: originalActivity.ai_feedback,
                originalParentFeedback: originalActivity.parent_feedback,
                originalAnswersText: originalActivity.answers_text ?? null,
                followupTitle: activity.title,
                followupNote: aiNote,
                followupAiFeedback: aiFeedback,
                followupParentFeedback: feedbackToSave || null,
                followupAnswersText: answersText || null,
                childName,
                childAge,
                childGender,
              }),
              response_json_schema: {
                type: 'object',
                properties: {
                  progress_observation: {
                    type: 'string',
                    enum: ['Improved', 'Needs More Attention', 'No Improvement'],
                  },
                },
              },
            });
            const data = result as Record<string, unknown>;
            progressObservation =
              (unwrapLLM(data.progress_observation) as string | undefined) ?? 'No Improvement';
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
          what_changed: whatChanged,
          what_learned: whatLearned,
          recommendation,
          answers_text: answersText,
          parent_feedback: feedbackToSave || null,
        });
      } finally {
        dispatch({ type: 'SET_SAVING', value: false });
      }
    },
    [
      dispatch,
      isScorableActivity,
      originalActivity,
      activity.title,
      aiNote,
      aiFeedback,
      whatChanged,
      whatLearned,
      recommendation,
      answersText,
      aiScore,
      childName,
      childAge,
      childGender,
      onComplete,
    ],
  );

  const currentQuestion = questions[currentQuestionIndex];
  const progress = questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={activity.title}
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16, transition: { duration: 0.25, ease: 'easeIn' } }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="border-edge max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="relative rounded-t-3xl bg-gradient-to-br from-primary-dark to-primary-medium p-6">
          <button
            onClick={onClose}
            aria-label="Close activity"
            className="bg-ghost-xl hover:bg-ghost-xl absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors"
          >
            <X className="h-5 w-5 text-white" />
          </button>

          <div className="mb-4 flex items-start gap-4 pr-10">
            <div className="bg-ghost-xl flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl backdrop-blur-sm">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold leading-tight text-white">{activity.title}</h2>
              <p className="mt-0.5 text-sm leading-snug text-white/90">
                {activity.objective as string}
              </p>
            </div>
          </div>

          {step === ACTIVITY_STEPS.QUESTIONS && questions.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm text-white/90">
                <span>
                  Question {currentQuestionIndex + 1} of {questions.length}
                </span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="bg-ghost-xl h-1.5 overflow-hidden rounded-full">
                <motion.div
                  className="h-full rounded-full bg-white"
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
                className="flex flex-col items-center gap-4 py-16"
                aria-live="polite"
                aria-busy="true"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent"
                  aria-hidden="true"
                />
                <p className="font-medium text-muted-foreground">Preparing activity...</p>
              </motion.div>
            )}

            {step === ACTIVITY_STEPS.QUESTIONS && currentQuestion && (
              <motion.div
                key={`q-${currentQuestionIndex}`}
                initial={{ opacity: 0, x: direction * 48 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{
                  opacity: 0,
                  x: direction * -48,
                  transition: { duration: 0.3, ease: 'easeIn' },
                }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="py-4"
              >
                <h3 className="mb-6 text-lg font-bold leading-snug text-foreground">
                  {currentQuestion.question}
                </h3>

                {currentQuestion.type === 'choice' && (
                  <div className="space-y-3">
                    {currentQuestion.options?.map((option) => (
                      <motion.button
                        key={option}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleChoiceSelect(option)}
                        className={`w-full rounded-2xl border-2 p-4 text-left transition-all ${
                          currentAnswer === option
                            ? 'border-primary-medium bg-primary-medium/10'
                            : 'border-c-edge hover:border-c-bright bg-surface-input'
                        }`}
                      >
                        <span className="font-medium text-foreground">{option}</span>
                      </motion.button>
                    ))}
                    {currentQuestionIndex > 0 && (
                      <button
                        onClick={handleGoBack}
                        className="mt-2 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronLeft className="h-4 w-4" /> Previous
                      </button>
                    )}
                  </div>
                )}

                {currentQuestion.type === 'text' && (
                  <div className="space-y-4">
                    <TextareaWithVoice
                      value={currentAnswer}
                      onChange={(e) =>
                        dispatch({
                          type: 'SET_CURRENT_ANSWER',
                          value: (e as ChangeEvent<HTMLTextAreaElement>).target.value,
                        })
                      }
                      placeholder="Type or speak your answer..."
                      className="min-h-[120px] resize-none rounded-2xl"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      {currentQuestionIndex > 0 ? (
                        <Button
                          variant="outline"
                          onClick={handleGoBack}
                          className="border-edge-strong h-12 rounded-2xl bg-transparent text-base text-muted-foreground hover:bg-subtle"
                        >
                          <ChevronLeft className="mr-1 h-5 w-5" /> Previous
                        </Button>
                      ) : (
                        <div />
                      )}
                      <Button
                        onClick={handleAnswerQuestion}
                        disabled={!currentAnswer.trim()}
                        className="h-12 rounded-2xl bg-primary-action text-base font-semibold text-white hover:bg-primary-action/90 disabled:opacity-50"
                      >
                        Next <ChevronRight className="ml-1 h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                )}

                {currentQuestion.type === 'scale' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-2">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <motion.button
                          key={value}
                          whileTap={{ scale: 0.92 }}
                          onClick={() =>
                            dispatch({ type: 'SET_CURRENT_ANSWER', value: value.toString() })
                          }
                          className={`h-16 flex-1 rounded-2xl text-xl font-bold transition-all ${
                            currentAnswer === value.toString()
                              ? 'bg-primary-action text-white shadow-lg'
                              : 'bg-ghost-light hover:bg-ghost-strong text-muted-foreground'
                          }`}
                        >
                          {value}
                        </motion.button>
                      ))}
                    </div>
                    {currentQuestion.labels && currentQuestion.labels.length > 0 && (
                      <div className="flex justify-between px-1 text-sm text-subtle">
                        <span>{currentQuestion.labels[0]}</span>
                        <span>{currentQuestion.labels[1]}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {currentQuestionIndex > 0 ? (
                        <Button
                          variant="outline"
                          onClick={handleGoBack}
                          className="border-edge-strong h-12 rounded-2xl bg-transparent text-base text-muted-foreground hover:bg-subtle"
                        >
                          <ChevronLeft className="mr-1 h-5 w-5" /> Previous
                        </Button>
                      ) : (
                        <div />
                      )}
                      <Button
                        onClick={handleAnswerQuestion}
                        disabled={!currentAnswer}
                        className={`h-12 rounded-2xl text-base font-semibold transition-all ${
                          currentAnswer
                            ? 'bg-primary-action text-white hover:bg-primary-action/90'
                            : 'cursor-not-allowed bg-primary-action/30 text-white'
                        }`}
                      >
                        Next <ChevronRight className="ml-1 h-5 w-5" />
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
                className="flex flex-col items-center gap-4 py-16"
                aria-live="polite"
                aria-busy="true"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent"
                  aria-hidden="true"
                />
                <p className="text-lg font-semibold text-foreground">Analysing the response...</p>
                <p className="text-sm text-subtle">Just a moment</p>
              </motion.div>
            )}

            {step === ACTIVITY_STEPS.COMPLETE && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="space-y-5 py-4"
              >
                {/* Header */}
                <div className="flex flex-col items-center gap-2">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning-medium/10">
                    <Trophy className="h-8 w-8 text-warning" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground">
                    Activity Complete! <span aria-hidden="true">🎉</span>
                  </h3>
                  <p className="text-muted-foreground">Well done, {childName ?? 'there'}!</p>
                </div>

                {/* Score / Note */}
                <div className="border-edge bg-ghost-md flex items-center gap-4 rounded-2xl p-4">
                  <div className="flex-shrink-0 text-center">
                    {isScorableActivity ? (
                      <>
                        <p className="mb-0.5 text-xs font-semibold text-muted-foreground">
                          AI Score
                        </p>
                        <p className="text-3xl font-bold leading-none text-foreground">
                          {aiScore}
                          <span className="text-base font-normal text-subtle">/10</span>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mb-0.5 text-xs font-semibold text-muted-foreground">Note</p>
                        <p className="max-w-[110px] text-sm font-bold leading-snug text-foreground">
                          {aiNote}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="bg-ghost-strong h-12 w-px" />
                  <div className="flex-1 space-y-3 text-sm">
                    {/* What changed */}
                    {whatChanged && (
                      <div>
                        <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-subtle">
                          What changed
                        </p>
                        <p className="leading-snug text-foreground">{whatChanged}</p>
                      </div>
                    )}
                    {/* What learned */}
                    {whatLearned && (
                      <div>
                        <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-subtle">
                          What was learnt
                        </p>
                        <p className="leading-snug text-foreground">{whatLearned}</p>
                      </div>
                    )}
                    {/* Recommendation */}
                    {recommendation && (
                      <div>
                        <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-primary-medium">
                          Recommendation
                        </p>
                        <p className="leading-snug text-primary-light">{recommendation}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Parent confirmation flow */}
                <AnimatePresence mode="wait">
                  {confirmationStep === 'options' && (
                    <motion.div
                      key="conf-options"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-3"
                    >
                      <p className="text-center text-sm font-medium text-muted-foreground">
                        Parent — please review and respond:
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          onClick={() => {
                            void handleSaveAndContinue('').then(() => {
                              dispatch({
                                type: 'SET_CONFIRMATION_STEP',
                                value: 'thank_you_acknowledge',
                              });
                              setTimeout(onClose, 1800);
                            });
                          }}
                          disabled={isSaving}
                          className="h-12 rounded-2xl bg-primary-action text-base font-semibold text-white hover:bg-primary-action/90 disabled:opacity-50"
                        >
                          {isSaving ? 'Saving…' : 'Acknowledge ✓'}
                        </Button>
                        <Button
                          onClick={() =>
                            dispatch({ type: 'SET_CONFIRMATION_STEP', value: 'feedback_form' })
                          }
                          disabled={isSaving}
                          variant="outline"
                          className="border-edge-strong h-12 rounded-2xl bg-transparent text-base font-semibold text-foreground hover:bg-subtle"
                        >
                          Give Feedback
                        </Button>
                      </div>
                    </motion.div>
                  )}

                  {confirmationStep === 'feedback_form' && (
                    <motion.div
                      key="conf-feedback"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-3"
                    >
                      <label className="block text-sm font-semibold text-foreground">
                        Your feedback
                      </label>
                      <TextareaWithVoice
                        value={parentFeedback}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_PARENT_FEEDBACK',
                            value: (e as ChangeEvent<HTMLTextAreaElement>).target.value,
                          })
                        }
                        placeholder="Share your observations about your child's performance…"
                        className="min-h-[100px] resize-none rounded-2xl"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          variant="outline"
                          onClick={() =>
                            dispatch({ type: 'SET_CONFIRMATION_STEP', value: 'options' })
                          }
                          className="border-edge-strong h-12 rounded-2xl bg-transparent text-base text-muted-foreground hover:bg-subtle"
                        >
                          ← Back
                        </Button>
                        <Button
                          onClick={() => {
                            void handleSaveAndContinue(parentFeedback).then(() => {
                              dispatch({
                                type: 'SET_CONFIRMATION_STEP',
                                value: 'thank_you_feedback',
                              });
                              setTimeout(onClose, 2000);
                            });
                          }}
                          disabled={isSaving || !parentFeedback.trim()}
                          className="h-12 rounded-2xl bg-primary-action text-base font-semibold text-white hover:bg-primary-action/90 disabled:opacity-50"
                        >
                          {isSaving ? 'Saving…' : 'Submit Feedback'}
                        </Button>
                      </div>
                    </motion.div>
                  )}

                  {confirmationStep === 'thank_you_acknowledge' && (
                    <motion.div
                      key="conf-ty-ack"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4 }}
                      className="flex flex-col items-center gap-2 py-4 text-center"
                    >
                      <p className="text-2xl font-bold text-foreground">Thank you 🙏</p>
                      <p className="text-sm text-muted-foreground">Closing in a moment…</p>
                    </motion.div>
                  )}

                  {confirmationStep === 'thank_you_feedback' && (
                    <motion.div
                      key="conf-ty-fb"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4 }}
                      className="flex flex-col items-center gap-2 py-4 text-center"
                    >
                      <p className="text-2xl font-bold text-foreground">
                        Thank you for your feedback 🙏
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Your feedback has been saved. Closing in a moment…
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
