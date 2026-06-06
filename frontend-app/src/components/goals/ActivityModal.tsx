import { useReducer, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Modal } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  useModalScale,
  useSpinner,
  useSlideUpWhenReady,
  useFadeIn,
} from '@/lib/animations';
import { Button } from '@/components/ui/Button';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { GradientSurface } from '@/components/shared/GradientView';
import {
  X,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Trophy,
} from 'lucide-react-native';
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
  confirmationStep:
    | 'options'
    | 'feedback_form'
    | 'thank_you_acknowledge'
    | 'thank_you_feedback';
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

function activityReducer(
  state: ActivityState,
  action: ActivityAction,
): ActivityState {
  switch (action.type) {
    case 'QUESTIONS_LOADED':
      return {
        ...state,
        questions: action.questions,
        step: ACTIVITY_STEPS.QUESTIONS,
      };
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
    question:
      'What do you think will be the most exciting part of this activity?',
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
  note?: string;
  ai_feedback?: string;
  parent_feedback?: string;
  completed?: boolean;
  score?: number;
  what_changed?: string;
  answers_text?: string;
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

  // Animations
  const overlayStyle = useFadeIn(0, 300);
  const cardStyle = useModalScale(true);
  const spinnerStyle = useSpinner();
  const completeStyle = useSlideUpWhenReady(
    step === ACTIVITY_STEPS.COMPLETE,
    0,
    600,
  );

  // Question slide animation
  const slideX = useSharedValue(0);
  const questionOpacity = useSharedValue(1);
  useEffect(() => {
    if (step !== ACTIVITY_STEPS.QUESTIONS || questions.length === 0) return;
    slideX.value = direction * 48;
    questionOpacity.value = 0;
    slideX.value = withTiming(0, {
      duration: 400,
      easing: Easing.out(Easing.ease),
    });
    questionOpacity.value = withTiming(1, {
      duration: 400,
      easing: Easing.out(Easing.ease),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex]);

  const questionSlideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideX.value }],
    opacity: questionOpacity.value,
  }));

  // Progress bar animation
  const progress =
    questions.length > 0
      ? ((currentQuestionIndex + 1) / questions.length) * 100
      : 0;
  const progressWidth = useSharedValue(0);
  useEffect(() => {
    progressWidth.value = withTiming(progress, { duration: 450 });
  }, [progress, progressWidth]);
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%` as `${number}%`,
  }));

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
      dispatch({
        type: 'QUESTIONS_LOADED',
        questions: rawArr.length ? rawArr : fallbackQuestions,
      });
    } catch (err) {
      console.warn(
        '[ActivityModal] Question generation failed, using fallback:',
        err,
      );
      dispatch({ type: 'QUESTIONS_LOADED', questions: fallbackQuestions });
    }
  }, [
    activity.title,
    activity.objective,
    childName,
    childAge,
    childGender,
    goal,
    impact,
  ]);

  useEffect(() => {
    void generateQuestions();
    return () => {
      if (choiceTimeoutRef.current !== null)
        clearTimeout(choiceTimeoutRef.current);
    };
  }, [generateQuestions]);

  const analyzeResponses = useCallback(
    async (allResponses: Record<string | number, QuestionResponse>) => {
      dispatch({ type: 'SET_STEP', step: ACTIVITY_STEPS.ANALYZING });
      try {
        const builtAnswersText = Object.values(allResponses)
          .map(r => {
            const typeHint =
              r.type === 'scale' ? ' (rated on a scale of 1–5)' : '';
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
              originalScore: isFollowUp
                ? originalActivity?.score ?? null
                : null,
              originalWhatChanged: isFollowUp
                ? originalActivity?.what_changed ?? null
                : null,
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
          const score =
            (unwrapLLM(data.score) as number | null | undefined) ?? 5;
          const wc =
            (unwrapLLM(data.what_changed) as string | undefined) ?? null;
          dispatch({
            type: 'ANALYSIS_COMPLETE',
            payload: {
              aiScore: score,
              aiFeedback: wc ?? 'Activity completed.',
              whatChanged: wc,
              whatLearned:
                (unwrapLLM(data.what_learned) as string | undefined) ?? null,
              recommendation:
                (unwrapLLM(data.recommendation) as string | undefined) ?? null,
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
              originalNote: isFollowUp ? originalActivity?.note ?? null : null,
              originalWhatChanged: isFollowUp
                ? originalActivity?.what_changed ?? null
                : null,
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
          const wc =
            (unwrapLLM(data.what_changed) as string | undefined) ?? null;
          dispatch({
            type: 'ANALYSIS_COMPLETE',
            payload: {
              aiNote:
                (unwrapLLM(data.note) as string | undefined) ??
                'Activity completed.',
              aiFeedback: wc ?? 'Activity completed.',
              whatChanged: wc,
              whatLearned:
                (unwrapLLM(data.what_learned) as string | undefined) ?? null,
              recommendation:
                (unwrapLLM(data.recommendation) as string | undefined) ?? null,
              answersText: builtAnswersText,
            },
          });
        }
      } catch (err) {
        console.warn(
          '[ActivityModal] AI analysis failed, using defaults:',
          err,
        );
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
    (
      newResponses: Record<string | number, QuestionResponse>,
      questionIdx: number,
    ) => {
      if (questionIdx < questions.length - 1) {
        dispatch({
          type: 'ADVANCE_QUESTION',
          index: questionIdx + 1,
          responses: newResponses,
        });
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
      [question.id]: {
        question: question.question,
        answer: currentAnswer,
        type: question.type,
      },
    };
    advanceOrAnalyze(newResponses, currentQuestionIndex);
  }, [
    questions,
    currentQuestionIndex,
    responses,
    currentAnswer,
    advanceOrAnalyze,
  ]);

  const handleChoiceSelect = useCallback(
    (option: string) => {
      if (choiceTimeoutRef.current !== null)
        clearTimeout(choiceTimeoutRef.current);
      const question = questions[currentQuestionIndex];
      if (!question) return;
      const idx = currentQuestionIndex;
      const newResponses = {
        ...responses,
        [question.id]: {
          question: question.question,
          answer: option,
          type: 'choice',
        },
      };
      dispatch({ type: 'SET_CURRENT_ANSWER', value: option });
      choiceTimeoutRef.current = setTimeout(() => {
        advanceOrAnalyze(newResponses, idx);
      }, CHOICE_FEEDBACK_DELAY_MS);
    },
    [questions, currentQuestionIndex, responses, dispatch, advanceOrAnalyze],
  );

  const handleGoBack = useCallback(() => {
    if (choiceTimeoutRef.current !== null)
      clearTimeout(choiceTimeoutRef.current);
    const prevIdx = currentQuestionIndex - 1;
    const prevQuestion = questions[prevIdx];
    const savedAnswer = prevQuestion
      ? responses[prevQuestion.id]?.answer ?? ''
      : '';
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
                    enum: [
                      'Improved',
                      'Needs More Attention',
                      'No Improvement',
                    ],
                  },
                },
              },
            });
            const data = result as Record<string, unknown>;
            progressObservation =
              (unwrapLLM(data.progress_observation) as string | undefined) ??
              'No Improvement';
          } catch (err) {
            console.warn(
              '[ActivityModal] Progress comparison failed, defaulting:',
              err,
            );
            progressObservation = 'No Improvement';
          }
        }

        await onComplete({
          score: isScorableActivity ? aiScore : null,
          note: isScorableActivity ? null : aiNote,
          progress_observation: progressObservation,
          ai_feedback: aiFeedback,
          parent_feedback: feedbackToSave || null,
          what_changed: whatChanged,
          what_learned: whatLearned,
          recommendation,
          answers_text: answersText,
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

  return (
    <Modal visible animationType="none" transparent onRequestClose={onClose}>
      <Animated.View
        style={overlayStyle}
        className="flex-1 items-center justify-center bg-black/40 p-4"
      >
        <Animated.View
          accessibilityRole="none"
          accessibilityLabel={activity.title}
          style={[cardStyle, { maxHeight: '90%' as const }]}
          className="border border-slate-700 w-full max-w-lg rounded-3xl bg-slate-900 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <GradientSurface
            from="#2dd4bf"
            to="#10b981"
            diagonal
            className="rounded-t-3xl p-6"
          >
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close activity"
              className="absolute right-4 top-4 h-8 w-8 items-center justify-center rounded-full bg-white/20"
            >
              <X size={20} color="white" />
            </Pressable>

            <View className="mb-4 flex-row items-start gap-4 pr-10">
              <View className="w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/20">
                <Sparkles size={28} color="white" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-bold leading-tight text-white">
                  {activity.title}
                </Text>
                <Text className="mt-0.5 text-base leading-snug text-white/90">
                  {activity.objective as string}
                </Text>
              </View>
            </View>

            {step === ACTIVITY_STEPS.QUESTIONS && questions.length > 0 && (
              <View className="gap-1.5">
                <View className="flex-row justify-between">
                  <Text className="text-sm text-white/90">
                    Question {currentQuestionIndex + 1} of {questions.length}
                  </Text>
                  <Text className="text-sm text-white/90">
                    {Math.round(progress)}%
                  </Text>
                </View>
                <View className="h-1.5 overflow-hidden rounded-full bg-white/20">
                  <Animated.View
                    style={progressStyle}
                    className="h-full rounded-full bg-white"
                  />
                </View>
              </View>
            )}
          </GradientSurface>

          {/* Body */}
          <ScrollView className="p-6">
            {step === ACTIVITY_STEPS.LOADING && (
              <View className="items-center gap-4 py-16">
                <Animated.View
                  style={spinnerStyle}
                  className="h-10 w-10 rounded-full border-4 border-teal-500 border-t-transparent"
                />
                <Text className="font-medium text-slate-400">
                  Preparing activity...
                </Text>
              </View>
            )}

            {step === ACTIVITY_STEPS.QUESTIONS && currentQuestion && (
              <Animated.View style={questionSlideStyle} className="py-4">
                <Text className="mb-6 text-lg font-bold leading-snug text-white">
                  {currentQuestion.question}
                </Text>

                {currentQuestion.type === 'choice' && (
                  <View className="gap-3">
                    {currentQuestion.options?.map(option => (
                      <Pressable
                        key={option}
                        onPress={() => handleChoiceSelect(option)}
                        className={`w-full rounded-2xl border-2 p-4 ${
                          currentAnswer === option
                            ? 'border-teal-500 bg-teal-500/10'
                            : 'border-slate-700 bg-slate-800'
                        }`}
                      >
                        <Text className="font-medium text-slate-300">
                          {option}
                        </Text>
                      </Pressable>
                    ))}
                    {currentQuestionIndex > 0 && (
                      <Pressable
                        onPress={handleGoBack}
                        className="mt-2 flex-row items-center gap-1"
                      >
                        <ChevronLeft size={16} color="#64748b" />
                        <Text className="text-sm text-slate-500">Previous</Text>
                      </Pressable>
                    )}
                  </View>
                )}

                {currentQuestion.type === 'text' && (
                  <View className="gap-4">
                    <TextareaWithVoice
                      value={currentAnswer}
                      onChange={e =>
                        dispatch({
                          type: 'SET_CURRENT_ANSWER',
                          value: e.target.value,
                        })
                      }
                      placeholder="Type or speak your answer..."
                      className="min-h-[120px] rounded-2xl"
                    />
                    <View className="flex-row gap-3">
                      {currentQuestionIndex > 0 ? (
                        <Button
                          size="xl"
                          variant="outline"
                          onPress={handleGoBack}
                          className="flex-1 rounded-2xl"
                        >
                          <View className="flex-row items-center gap-1">
                            <ChevronLeft size={20} color="#94a3b8" />
                            <Text className="text-slate-400">Previous</Text>
                          </View>
                        </Button>
                      ) : (
                        <View className="flex-1" />
                      )}
                      <Button
                        size="xl"
                        onPress={handleAnswerQuestion}
                        disabled={!currentAnswer.trim()}
                        className="flex-1 rounded-2xl bg-teal-500"
                      >
                        <View className="flex-row items-center gap-1">
                          <Text className="font-semibold text-white">Next</Text>
                          <ChevronRight size={20} color="white" />
                        </View>
                      </Button>
                    </View>
                  </View>
                )}

                {currentQuestion.type === 'scale' && (
                  <View className="gap-6">
                    <View className="flex-row items-center justify-between gap-2">
                      {[1, 2, 3, 4, 5].map(value => (
                        <Pressable
                          key={value}
                          onPress={() =>
                            dispatch({
                              type: 'SET_CURRENT_ANSWER',
                              value: value.toString(),
                            })
                          }
                          className={`h-16 flex-1 items-center justify-center rounded-2xl ${
                            currentAnswer === value.toString()
                              ? 'bg-teal-500'
                              : 'bg-slate-800'
                          }`}
                        >
                          <Text
                            className={`text-xl font-bold ${
                              currentAnswer === value.toString()
                                ? 'text-white'
                                : 'text-slate-400'
                            }`}
                          >
                            {value}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {currentQuestion.labels &&
                      currentQuestion.labels.length > 0 && (
                        <View className="flex-row justify-between px-1">
                          <Text className="text-sm text-slate-500">
                            {currentQuestion.labels[0]}
                          </Text>
                          <Text className="text-sm text-slate-500">
                            {currentQuestion.labels[1]}
                          </Text>
                        </View>
                      )}
                    <View className="flex-row gap-3">
                      {currentQuestionIndex > 0 ? (
                        <Button
                          size="xl"
                          variant="outline"
                          onPress={handleGoBack}
                          className="flex-1 rounded-2xl"
                        >
                          <View className="flex-row items-center gap-1">
                            <ChevronLeft size={20} color="#94a3b8" />
                            <Text className="text-slate-400">Previous</Text>
                          </View>
                        </Button>
                      ) : (
                        <View className="flex-1" />
                      )}
                      <Button
                        size="xl"
                        onPress={handleAnswerQuestion}
                        disabled={!currentAnswer}
                        className="flex-1 rounded-2xl bg-teal-500"
                      >
                        <View className="flex-row items-center gap-1">
                          <Text className="font-semibold text-white">Next</Text>
                          <ChevronRight size={20} color="white" />
                        </View>
                      </Button>
                    </View>
                  </View>
                )}
              </Animated.View>
            )}

            {step === ACTIVITY_STEPS.ANALYZING && (
              <View className="items-center gap-4 py-16">
                <Animated.View
                  style={spinnerStyle}
                  className="w-12 rounded-full border-4 border-teal-500 border-t-transparent"
                />
                <Text className="text-lg font-semibold text-white">
                  Analysing the response...
                </Text>
                <Text className="text-base text-slate-500">Just a moment</Text>
              </View>
            )}

            {step === ACTIVITY_STEPS.COMPLETE && (
              <Animated.View style={completeStyle} className="gap-5 py-4">
                <View className="items-center gap-2">
                  <View className="h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
                    <Trophy size={32} color="#fbbf24" />
                  </View>
                  <Text className="text-2xl font-bold text-white">
                    Activity Complete! 🎉
                  </Text>
                  <Text className="text-slate-400">
                    Well done, {childName ?? 'there'}!
                  </Text>
                </View>

                {/* Score / Note */}
                <View className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  {isScorableActivity ? (
                    <View className="flex-row items-center gap-3">
                      <View>
                        <Text className="mb-0.5 text-xs font-semibold text-emerald-400">
                          AI Score
                        </Text>
                        <Text className="text-3xl font-bold leading-none text-emerald-300">
                          {aiScore}
                          <Text className="text-base font-normal text-emerald-500">
                            /10
                          </Text>
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View>
                      <Text className="mb-0.5 text-xs font-semibold text-emerald-400">
                        Note
                      </Text>
                      <Text className="text-base font-bold leading-snug text-emerald-300">
                        {aiNote}
                      </Text>
                    </View>
                  )}
                </View>

                {/* What changed / learned / recommendation */}
                {whatChanged && (
                  <View className="rounded-2xl border border-slate-700 bg-slate-800 p-4 gap-1">
                    <Text className="text-xs font-semibold text-teal-400">
                      What Changed
                    </Text>
                    <Text className="text-sm text-slate-300">
                      {whatChanged}
                    </Text>
                  </View>
                )}
                {whatLearned && (
                  <View className="rounded-2xl border border-slate-700 bg-slate-800 p-4 gap-1">
                    <Text className="text-xs font-semibold text-teal-400">
                      What Was Learned
                    </Text>
                    <Text className="text-sm text-slate-300">
                      {whatLearned}
                    </Text>
                  </View>
                )}
                {recommendation && (
                  <View className="rounded-2xl border border-slate-700 bg-slate-800 p-4 gap-1">
                    <Text className="text-xs font-semibold text-amber-400">
                      Recommendation
                    </Text>
                    <Text className="text-sm text-slate-300">
                      {recommendation}
                    </Text>
                  </View>
                )}

                {/* Confirmation step flow */}
                {confirmationStep === 'options' && (
                  <View className="gap-3">
                    <Button
                      onPress={() => {
                        void handleSaveAndContinue('').then(() => {
                          dispatch({
                            type: 'SET_CONFIRMATION_STEP',
                            value: 'thank_you_acknowledge',
                          });
                          setTimeout(onClose, 1800);
                        });
                      }}
                      disabled={isSaving}
                      className="w-full rounded-2xl bg-teal-500"
                    >
                      <Text className="font-semibold text-white">
                        {isSaving ? 'Saving...' : 'Acknowledge & Continue'}
                      </Text>
                    </Button>
                    <Button
                      variant="outline"
                      onPress={() =>
                        dispatch({
                          type: 'SET_CONFIRMATION_STEP',
                          value: 'feedback_form',
                        })
                      }
                      disabled={isSaving}
                      className="w-full rounded-2xl"
                    >
                      <Text className="font-semibold text-slate-300">
                        Give Feedback
                      </Text>
                    </Button>
                  </View>
                )}

                {confirmationStep === 'feedback_form' && (
                  <View className="gap-3">
                    <Text className="font-semibold text-slate-300">
                      Parent Feedback{' '}
                      <Text className="font-normal text-slate-400">
                        (optional)
                      </Text>
                    </Text>
                    <TextareaWithVoice
                      value={parentFeedback}
                      onChange={e =>
                        dispatch({
                          type: 'SET_PARENT_FEEDBACK',
                          value: e.target.value,
                        })
                      }
                      placeholder="Share your observations about your child's performance..."
                      className="min-h-[100px] rounded-2xl"
                    />
                    <View className="flex-row gap-3">
                      <Button
                        variant="outline"
                        onPress={() =>
                          dispatch({
                            type: 'SET_CONFIRMATION_STEP',
                            value: 'options',
                          })
                        }
                        className="flex-1 rounded-2xl"
                      >
                        <Text className="text-slate-400">← Back</Text>
                      </Button>
                      <Button
                        onPress={() => {
                          void handleSaveAndContinue(parentFeedback).then(
                            () => {
                              dispatch({
                                type: 'SET_CONFIRMATION_STEP',
                                value: 'thank_you_feedback',
                              });
                              setTimeout(onClose, 2000);
                            },
                          );
                        }}
                        disabled={isSaving}
                        className="flex-1 rounded-2xl bg-teal-500"
                      >
                        <Text className="font-semibold text-white">
                          {isSaving ? 'Saving...' : 'Submit Feedback'}
                        </Text>
                      </Button>
                    </View>
                  </View>
                )}

                {(confirmationStep === 'thank_you_acknowledge' ||
                  confirmationStep === 'thank_you_feedback') && (
                  <View className="items-center gap-2 py-4">
                    <Text className="text-lg font-bold text-white">
                      Thank you! 🌟
                    </Text>
                    <Text className="text-sm text-slate-400 text-center">
                      {confirmationStep === 'thank_you_feedback'
                        ? 'Your feedback has been saved.'
                        : 'Activity saved successfully.'}
                    </Text>
                  </View>
                )}
              </Animated.View>
            )}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
