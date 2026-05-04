import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Trophy, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { api } from '@/api/client';

export default function ActivityModal({ activity, childName, onClose, onComplete }) {
  const [step, setStep] = useState('loading');
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward
  const [responses, setResponses] = useState({});
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [aiScore, setAiScore] = useState(null);
  const [aiFeedback, setAiFeedback] = useState('');
  const [parentFeedback, setParentFeedback] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const choiceTimeoutRef = useRef(null);

  const fallbackQuestions = [
    { id: 1, type: 'choice', question: `What part of "${activity.title}" are you most excited about?`, options: ['Learning something new', 'Having fun with it', 'Showing my skills', 'Doing it with others'], labels: [] },
    { id: 2, type: 'text', question: 'What do you think will be the most exciting part of this activity?', options: [], labels: [] },
    { id: 3, type: 'scale', question: 'How excited are you about this activity?', options: [], labels: ['Not excited', 'Super excited'] },
    { id: 4, type: 'text', question: 'What do you hope to learn or achieve from this?', options: [], labels: [] }
  ];

  const generateQuestions = async () => {
    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Generate 4 engaging questions for a child activity called "${activity.title}".
Activity objective: "${activity.objective}"
Child name: ${childName || 'the child'}

Generate exactly 4 questions in this order:
1. type "choice" — a fun multiple-choice question with exactly 4 text options. Set "options" to the 4 choices. Set "labels" to [].
2. type "text" — an open-ended question about what excites them about this activity. Set "options" to []. Set "labels" to [].
3. type "scale" — a 1-to-5 rating question. Set "options" to []. Set "labels" to a 2-item array [minLabel, maxLabel] (e.g. ["Hard", "Easy"]).
4. type "text" — a short reflection question after completing the activity. Set "options" to []. Set "labels" to [].

Rules:
- Keep questions simple and child-friendly.
- Only populate "options" for type "choice". Only populate "labels" for type "scale". Leave both as [] otherwise.
- Do not repeat the child's name in every question — use it at most once.`,
        response_json_schema: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'number' },
                  type: { type: 'string' },
                  question: { type: 'string' },
                  options: { type: 'array', items: { type: 'string' } },
                  labels: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        }
      });
      const raw = result.properties?.questions ?? result.questions;
      const qs = raw?.length ? raw : fallbackQuestions;
      setQuestions(qs);
      setStep('questions');
    } catch {
      setQuestions(fallbackQuestions);
      setStep('questions');
    }
  };

  useEffect(() => {
    generateQuestions();
    return () => clearTimeout(choiceTimeoutRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const advanceOrAnalyze = (newResponses, questionIdx) => {
    setDirection(1);
    if (questionIdx < questions.length - 1) {
      setCurrentQuestionIndex(questionIdx + 1);
    } else {
      analyzeResponses(newResponses);
    }
  };

  const handleAnswerQuestion = () => {
    const question = questions[currentQuestionIndex];
    const newResponses = {
      ...responses,
      [question.id]: { question: question.question, answer: currentAnswer, type: question.type }
    };
    setResponses(newResponses);
    setCurrentAnswer('');
    advanceOrAnalyze(newResponses, currentQuestionIndex);
  };

  const handleChoiceSelect = (option) => {
    clearTimeout(choiceTimeoutRef.current);
    const question = questions[currentQuestionIndex];
    const idx = currentQuestionIndex;
    const newResponses = {
      ...responses,
      [question.id]: { question: question.question, answer: option, type: 'choice' }
    };
    setCurrentAnswer(option);
    choiceTimeoutRef.current = setTimeout(() => {
      setResponses(newResponses);
      setCurrentAnswer('');
      advanceOrAnalyze(newResponses, idx);
    }, 250);
  };

  const handleGoBack = () => {
    clearTimeout(choiceTimeoutRef.current);
    const prevIdx = currentQuestionIndex - 1;
    const prevQuestion = questions[prevIdx];
    const savedAnswer = responses[prevQuestion?.id]?.answer || '';
    setDirection(-1);
    setCurrentAnswer(savedAnswer);
    setCurrentQuestionIndex(prevIdx);
  };

  const analyzeResponses = async (allResponses) => {
    setStep('analyzing');
    try {
      const answersText = Object.values(allResponses)
        .map((r) => {
          const typeHint = r.type === 'scale' ? ' (rated on a scale of 1–5)' : '';
          return `Q: ${r.question}\nA: ${r.answer}${typeHint}`;
        })
        .join('\n\n');

      const result = await api.integrations.Core.InvokeLLM({
        prompt: `You are evaluating a young child's responses for the activity "${activity.title}".
Activity objective: "${activity.objective}"

Child's answers:
${answersText}

Scoring guidelines:
- This is a young child. Short but relevant answers (even 1–2 words) are perfectly valid — do not penalise brevity.
- For scale questions, treat the numeric rating at face value (e.g. "4" out of 5 is a strong response).
- For choice questions, any selection shows engagement.
- For text questions, reward relevance and effort over length.
- Give a score from 6–10 (never below 6 for a child who attempted all questions). Reserve 9–10 for exceptionally detailed or thoughtful answers.
- Write 1–2 sentences of child-friendly encouraging feedback that references what they actually said. Start with "Great job".`,
        response_json_schema: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            feedback: { type: 'string' }
          }
        }
      });
      const data = result.properties ?? result;
      setAiScore(data.score ?? 7);
      setAiFeedback(data.feedback || 'Great job completing this activity!');
      setStep('complete');
    } catch {
      setAiScore(7);
      setAiFeedback('Great job completing this activity with enthusiasm!');
      setStep('complete');
    }
  };

  const handleSaveAndContinue = async () => {
    setIsSaving(true);
    try {
      await onComplete({
        score: aiScore,
        ai_feedback: aiFeedback,
        parent_feedback: parentFeedback,
        responses: Object.values(responses)
      });
    } finally {
      setIsSaving(false);
    }
  };

  const currentQuestion = questions[currentQuestionIndex];
  const progress = questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        {/* Header */}
        <div className="p-6 bg-gradient-to-br from-teal-400 to-emerald-500 rounded-t-3xl relative">
          <button
            onClick={onClose}
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

          {step === 'questions' && questions.length > 0 && (
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
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {step === 'loading' && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-16 flex flex-col items-center gap-4"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full"
                />
                <p className="text-slate-500 font-medium">Preparing activity...</p>
              </motion.div>
            )}

            {step === 'questions' && currentQuestion && (
              <motion.div
                key={`q-${currentQuestionIndex}`}
                initial={{ opacity: 0, x: direction * 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -40 }}
                className="py-4"
              >
                <h3 className="text-lg font-bold text-slate-800 mb-6 leading-snug">
                  {currentQuestion.question}
                </h3>

                {currentQuestion.type === 'choice' && (
                  <div className="space-y-3">
                    {currentQuestion.options?.map((option, i) => (
                      <motion.button
                        key={i}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleChoiceSelect(option)}
                        className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                          currentAnswer === option
                            ? 'border-teal-500 bg-teal-50'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <span className="font-medium text-slate-800">{option}</span>
                      </motion.button>
                    ))}
                    {currentQuestionIndex > 0 && (
                      <button
                        onClick={handleGoBack}
                        className="mt-2 flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
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
                      onChange={(e) => setCurrentAnswer(e.target.value)}
                      placeholder="Type or speak your answer..."
                      className="min-h-[120px] rounded-2xl resize-none"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      {currentQuestionIndex > 0 ? (
                        <Button
                          variant="outline"
                          onClick={handleGoBack}
                          className="h-12 rounded-2xl border-2 text-slate-500"
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
                          onClick={() => setCurrentAnswer(value.toString())}
                          className={`flex-1 h-16 rounded-2xl font-bold text-xl transition-all ${
                            currentAnswer === value.toString()
                              ? 'bg-teal-500 text-white shadow-lg'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
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
                          className="h-12 rounded-2xl border-2 text-slate-500"
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

            {step === 'analyzing' && (
              <motion.div
                key="analyzing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-16 flex flex-col items-center gap-4"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full"
                />
                <p className="text-slate-700 font-semibold text-lg">Analysing the response...</p>
                <p className="text-slate-400 text-sm">Just a moment</p>
              </motion.div>
            )}

            {step === 'complete' && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="py-4 space-y-5"
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                    <Trophy className="w-8 h-8 text-amber-500" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800">Activity Complete! 🎉</h3>
                  <p className="text-slate-500">Great work, {childName || 'there'}!</p>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-4 items-start">
                  <div className="flex-shrink-0">
                    <p className="text-xs font-semibold text-green-600 mb-0.5">AI Score</p>
                    <p className="text-3xl font-bold text-green-700 leading-none">
                      {aiScore}
                      <span className="text-base font-normal text-green-500">/10</span>
                    </p>
                  </div>
                  <p className="text-green-700 text-sm mt-1">✅ {aiFeedback}</p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">
                    Parent Feedback{' '}
                    <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <TextareaWithVoice
                    value={parentFeedback}
                    onChange={(e) => setParentFeedback(e.target.value)}
                    placeholder="Share your observations about your child's performance..."
                    className="min-h-[100px] rounded-2xl resize-none"
                  />
                </div>

                <Button
                  onClick={handleSaveAndContinue}
                  disabled={isSaving}
                  className="w-full h-12 rounded-2xl bg-teal-500 hover:bg-teal-600 text-white font-semibold"
                >
                  {isSaving ? 'Saving...' : 'Save & Continue 🚀'}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
