import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, Sparkles, Trophy, Star, Heart, Lightbulb, Smile, Rocket } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from '@/api/client';
import { pillarConfig } from '../shared/PillarIcon';
import { gameTemplates } from './GameTemplates';

// Mini-game generators for each pillar
const gameGenerators = {
  cognitive: {
    title: "Brain Booster Challenge",
    icon: Lightbulb,
    generateQuestions: (mission) => [
      {
        id: 1,
        type: 'choice',
        question: `Imagine you need to ${mission.title.toLowerCase()}. What's your first step?`,
        options: ['Think about it carefully', 'Jump right in and try', 'Ask someone for help', 'Look for examples']
      },
      {
        id: 2,
        type: 'scale',
        question: 'How confident do you feel about solving new problems?',
        min: 1,
        max: 5,
        labels: ['Not confident', 'Super confident']
      },
      {
        id: 3,
        type: 'text',
        question: 'Tell me about a time you figured something out on your own!'
      },
      {
        id: 4,
        type: 'choice',
        question: 'When something is difficult, you usually:',
        options: ['Keep trying different ways', 'Take a break and come back', 'Ask for hints', 'Try to make it easier']
      }
    ]
  },
  emotional: {
    title: "Heart Quest",
    icon: Heart,
    generateQuestions: (mission) => [
      {
        id: 1,
        type: 'choice',
        question: 'How are you feeling right now?',
        options: ['Happy & excited 😊', 'Calm & relaxed 😌', 'Curious & ready 🤔', 'A mix of feelings 😅']
      },
      {
        id: 2,
        type: 'text',
        question: 'What makes you feel really proud of yourself?'
      },
      {
        id: 3,
        type: 'scale',
        question: 'How good are you at understanding how others feel?',
        min: 1,
        max: 5,
        labels: ['Still learning', 'Really good']
      },
      {
        id: 4,
        type: 'choice',
        question: 'When a friend is sad, you:',
        options: ['Ask them what\'s wrong', 'Give them a hug', 'Try to cheer them up', 'Give them space']
      }
    ]
  },
  physical: {
    title: "Body & Movement Adventure",
    icon: Rocket,
    generateQuestions: (mission) => [
      {
        id: 1,
        type: 'choice',
        question: 'What kind of physical activity do you enjoy most?',
        options: ['Running & playing sports', 'Dancing & moving to music', 'Climbing & exploring', 'Stretching & yoga']
      },
      {
        id: 2,
        type: 'scale',
        question: 'How energetic do you feel today?',
        min: 1,
        max: 5,
        labels: ['Sleepy', 'Super energetic']
      },
      {
        id: 3,
        type: 'text',
        question: 'What\'s your favorite way to stay active?'
      },
      {
        id: 4,
        type: 'choice',
        question: 'After exercising, you usually feel:',
        options: ['Energized & happy', 'Tired but good', 'Hungry', 'Ready for more']
      }
    ]
  },
  talent: {
    title: "Talent Discovery Game",
    icon: Star,
    generateQuestions: (mission) => [
      {
        id: 1,
        type: 'text',
        question: 'What are you really good at? (It can be anything!)'
      },
      {
        id: 2,
        type: 'choice',
        question: 'When you practice something new, you:',
        options: ['Love the challenge', 'Like seeing progress', 'Prefer things you\'re already good at', 'It depends on what it is']
      },
      {
        id: 3,
        type: 'scale',
        question: 'How much do you enjoy learning new skills?',
        min: 1,
        max: 5,
        labels: ['Not much', 'Love it']
      },
      {
        id: 4,
        type: 'text',
        question: 'If you could become amazing at one thing, what would it be?'
      }
    ]
  },
  character: {
    title: "Character Builder",
    icon: Trophy,
    generateQuestions: (mission) => [
      {
        id: 1,
        type: 'choice',
        question: 'What matters most to you?',
        options: ['Being kind to others', 'Being honest & fair', 'Being brave & trying new things', 'Helping people']
      },
      {
        id: 2,
        type: 'text',
        question: 'Tell me about a time you helped someone!'
      },
      {
        id: 3,
        type: 'scale',
        question: 'How easy is it for you to admit when you make a mistake?',
        min: 1,
        max: 5,
        labels: ['Hard', 'Easy']
      },
      {
        id: 4,
        type: 'choice',
        question: 'When you see someone being left out, you:',
        options: ['Invite them to join', 'Feel bad for them', 'Wonder what to do', 'Talk to an adult about it']
      }
    ]
  },
  future: {
    title: "Dream Explorer",
    icon: Sparkles,
    generateQuestions: (mission) => [
      {
        id: 1,
        type: 'text',
        question: 'When you imagine your future, what excites you most?'
      },
      {
        id: 2,
        type: 'choice',
        question: 'If you could change one thing in the world, what would it be?',
        options: ['Help people who need it', 'Protect nature & animals', 'Create cool new things', 'Make everyone happy']
      },
      {
        id: 3,
        type: 'scale',
        question: 'How often do you think about what you want to do when you grow up?',
        min: 1,
        max: 5,
        labels: ['Rarely', 'All the time']
      },
      {
        id: 4,
        type: 'text',
        question: 'What kind of person do you want to become?'
      }
    ]
  }
};

const reflectionTypes = [
  { id: 'gratitude', label: 'Gratitude', emoji: '💝', question: 'What are you grateful for from this mission?' },
  { id: 'achievement', label: 'Win', emoji: '🏆', question: 'What did you accomplish? What are you proud of?' },
  { id: 'learning', label: 'Learning', emoji: '💡', question: 'What did you learn or discover about yourself?' },
  { id: 'feeling', label: 'Feeling', emoji: '😊', question: 'How do you feel after completing this?' },
  { id: 'dream', label: 'Dream', emoji: '✨', question: 'What dream or goal does this inspire you toward?' }
];

export default function MissionMiniGame({ mission, childId, onComplete, onCancel }) {
  const [step, setStep] = useState('intro');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [responses, setResponses] = useState({});
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [reflection, setReflection] = useState({ type: 'gratitude', content: '' });
  const [learningAreas, setLearningAreas] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pillar = mission.pillar || 'cognitive';
  const config = pillarConfig[pillar];
  
  // Check if mission has a game template
  const gameTemplateId = mission.activity_data?.game_template;
  const gameTemplate = gameTemplateId ? gameTemplates[gameTemplateId] : null;
  
  const gameConfig = gameTemplate || gameGenerators[pillar] || gameGenerators.cognitive;
  const Icon = gameTemplate ? () => <span className="text-3xl">{gameTemplate.icon}</span> : gameConfig.icon;
  
  // Generate questions from activity_data or use default generator
  const questions = mission.activity_data?.questions || gameConfig.generateQuestions?.(mission) || [];

  const handleAnswerQuestion = () => {
    const question = questions[currentQuestionIndex];
    setResponses({
      ...responses,
      [question.id]: {
        question: question.question,
        answer: currentAnswer,
        type: question.type
      }
    });
    setCurrentAnswer('');
    
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      setStep('reflection');
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // Save reflection
      await api.entities.Reflection.create({
        child_id: childId,
        type: reflection.type,
        content: reflection.content,
        pillar_tags: [pillar]
      });

      // Complete mission with all data
      await onComplete({
        responses: Object.values(responses),
        reflection: reflection.content,
        learning_areas: learningAreas
      });
    } catch (error) {
      console.error('Failed to complete mission:', error);
    }
    setIsSubmitting(false);
  };

  const currentQuestion = questions[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        {/* Header */}
        <div className={`p-6 bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo} rounded-t-3xl relative`}>
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
            {gameTemplate ? (
              <span className="text-3xl">{gameTemplate.icon}</span>
            ) : (
              <Icon className="w-8 h-8 text-white" />
            )}
            </div>
            <div>
            <h2 className="text-2xl font-bold text-white">{gameTemplate?.name || gameConfig.title}</h2>
            <p className="text-white/90 text-sm">{mission.title}</p>
            </div>
          </div>
          
          {step === 'game' && (
            <div className="space-y-2">
              <div className="flex justify-between text-white/90 text-sm">
                <span>Question {currentQuestionIndex + 1} of {questions.length}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
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

        {/* Content */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {step === 'intro' && (
              <motion.div
                key="intro"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center py-8"
              >
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-purple-500" />
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-3">
                  {gameTemplate ? `${gameTemplate.name}! 🎮` : 'Ready for an Adventure?'}
                </h3>
                <p className="text-slate-600 mb-6 max-w-md mx-auto">
                  {gameTemplate?.description || mission.description || `Complete this fun activity to grow your ${config.label} skills!`}
                </p>
                <div className="flex items-center justify-center gap-2 mb-8">
                  <span className="px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                    {questions.length} Fun Questions
                  </span>
                  <span className="px-4 py-2 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
                    ~5 minutes
                  </span>
                </div>
                <Button
                  onClick={() => setStep('game')}
                  className={`h-14 px-10 rounded-2xl bg-gradient-to-r ${config.gradientFrom} ${config.gradientTo} text-white font-bold text-lg shadow-lg`}
                >
                  Start Adventure! 🚀
                </Button>
              </motion.div>
            )}

            {step === 'game' && currentQuestion && (
              <motion.div
                key={`question-${currentQuestionIndex}`}
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                className="py-6"
              >
                <h3 className="text-xl font-bold text-slate-800 mb-6">
                  {currentQuestion.question}
                </h3>

                {currentQuestion.type === 'text' && (
                  <div className="space-y-4">
                    <Textarea
                      value={currentAnswer}
                      onChange={(e) => setCurrentAnswer(e.target.value)}
                      placeholder="Type your answer here..."
                      className="min-h-[120px] text-lg rounded-2xl"
                      autoFocus
                    />
                    <Button
                      onClick={handleAnswerQuestion}
                      disabled={!currentAnswer.trim()}
                      className={`w-full h-12 rounded-2xl bg-gradient-to-r ${config.gradientFrom} ${config.gradientTo}`}
                    >
                      Next <ChevronRight className="w-5 h-5 ml-2" />
                    </Button>
                  </div>
                )}

                {currentQuestion.type === 'choice' && (
                  <div className="space-y-3">
                    {currentQuestion.options.map((option, index) => (
                      <motion.button
                        key={index}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          setCurrentAnswer(option);
                          setTimeout(() => handleAnswerQuestion(), 300);
                        }}
                        className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                          currentAnswer === option
                            ? `${config.borderColor} ${config.bgColor}`
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <span className="font-medium text-slate-800">{option}</span>
                      </motion.button>
                    ))}
                  </div>
                )}

                {currentQuestion.type === 'scale' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center gap-4 px-4">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <motion.button
                          key={value}
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => setCurrentAnswer(value.toString())}
                          className={`w-16 h-16 rounded-full font-bold text-xl transition-all ${
                            currentAnswer === value.toString()
                              ? `bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo} text-white shadow-lg scale-110`
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          {value}
                        </motion.button>
                      ))}
                    </div>
                    <div className="flex justify-between text-sm text-slate-500 px-4">
                      <span>{currentQuestion.labels[0]}</span>
                      <span>{currentQuestion.labels[1]}</span>
                    </div>
                    <Button
                      onClick={handleAnswerQuestion}
                      disabled={!currentAnswer}
                      className={`w-full h-12 rounded-2xl bg-gradient-to-r ${config.gradientFrom} ${config.gradientTo}`}
                    >
                      Next <ChevronRight className="w-5 h-5 ml-2" />
                    </Button>
                  </div>
                )}
              </motion.div>
            )}

            {step === 'reflection' && (
              <motion.div
                key="reflection"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="py-6 space-y-6"
              >
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                    <Trophy className="w-10 h-10 text-amber-500" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800 mb-2">
                    Great Job! 🎉
                  </h3>
                  <p className="text-slate-600">
                    Now let's reflect on what you experienced
                  </p>
                </div>

                {/* Reflection Type Selection */}
                <div>
                  <p className="font-semibold text-slate-700 mb-3">What would you like to share?</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {reflectionTypes.map((type) => (
                      <button
                        key={type.id}
                        onClick={() => setReflection({ ...reflection, type: type.id })}
                        className={`p-3 rounded-xl border-2 transition-all ${
                          reflection.type === type.id
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="text-2xl mb-1">{type.emoji}</div>
                        <div className="text-sm font-medium text-slate-700">{type.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reflection Content */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-2">
                    {reflectionTypes.find(t => t.id === reflection.type)?.question}
                  </label>
                  <Textarea
                    value={reflection.content}
                    onChange={(e) => setReflection({ ...reflection, content: e.target.value })}
                    placeholder="Share your thoughts..."
                    className="min-h-[100px] rounded-2xl"
                  />
                </div>

                {/* Learning Areas */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-2">
                    What would you like to get better at?
                  </label>
                  <Textarea
                    value={learningAreas}
                    onChange={(e) => setLearningAreas(e.target.value)}
                    placeholder="Areas you want to improve or explore more..."
                    className="min-h-[80px] rounded-2xl"
                  />
                </div>

                <Button
                  onClick={handleComplete}
                  disabled={!reflection.content.trim() || isSubmitting}
                  className="w-full h-14 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 font-bold text-lg"
                >
                  {isSubmitting ? (
                    <>Completing Mission...</>
                  ) : (
                    <>
                      Complete Mission! <Trophy className="w-5 h-5 ml-2" />
                    </>
                  )}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}