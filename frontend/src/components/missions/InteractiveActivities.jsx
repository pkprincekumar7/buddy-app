import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChevronRight, ChevronLeft, Sparkles, Check } from 'lucide-react';

export default function InteractiveActivity({ mission, onComplete, onCancel }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState({});
  const [currentAnswer, setCurrentAnswer] = useState('');
  
  const questions = mission.activity_data?.questions || [];
  const currentQuestion = questions[currentStep];
  const isLastQuestion = currentStep === questions.length - 1;
  
  const handleNext = () => {
    if (currentAnswer.trim()) {
      setResponses({
        ...responses,
        [currentStep]: {
          question: currentQuestion.question,
          answer: currentAnswer,
          type: currentQuestion.type
        }
      });
      setCurrentAnswer('');
      
      if (isLastQuestion) {
        handleComplete();
      } else {
        setCurrentStep(currentStep + 1);
      }
    }
  };
  
  const handleComplete = () => {
    const allResponses = {
      ...responses,
      [currentStep]: {
        question: currentQuestion.question,
        answer: currentAnswer,
        type: currentQuestion.type
      }
    };
    onComplete(Object.values(allResponses));
  };
  
  const handleBack = () => {
    if (currentStep > 0) {
      const prevAnswer = responses[currentStep - 1]?.answer || '';
      setCurrentAnswer(prevAnswer);
      setCurrentStep(currentStep - 1);
    }
  };
  
  const renderQuestion = () => {
    if (!currentQuestion) return null;
    
    switch (currentQuestion.type) {
      case 'choice':
        return (
          <div className="space-y-3">
            {currentQuestion.options?.map((option, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => setCurrentAnswer(option)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  currentAnswer === option
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-slate-200 bg-white hover:border-purple-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">{option}</span>
                  {currentAnswer === option && (
                    <Check className="w-5 h-5 text-purple-500" />
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        );
        
      case 'scale':
        return (
          <div className="space-y-4">
            <div className="flex justify-between text-sm text-slate-500">
              <span>Not at all</span>
              <span>Very much</span>
            </div>
            <div className="flex gap-2 justify-center">
              {[1, 2, 3, 4, 5].map((num) => (
                <motion.button
                  key={num}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setCurrentAnswer(num.toString())}
                  className={`w-14 h-14 rounded-full font-bold transition-all ${
                    currentAnswer === num.toString()
                      ? 'bg-purple-500 text-white shadow-lg'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {num}
                </motion.button>
              ))}
            </div>
          </div>
        );
        
      case 'text':
      default:
        return (
          <Textarea
            value={currentAnswer}
            onChange={(e) => setCurrentAnswer(e.target.value)}
            placeholder="Type your answer here..."
            className="min-h-[120px] text-lg rounded-2xl"
          />
        );
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 p-6 rounded-t-3xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-slate-800">{mission.title}</h2>
            <button
              onClick={onCancel}
              className="text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          
          {/* Progress */}
          <div className="flex gap-2">
            {questions.map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-all ${
                  i === currentStep
                    ? 'bg-purple-500'
                    : i < currentStep
                      ? 'bg-emerald-400'
                      : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
          <p className="text-sm text-slate-500 mt-2">
            Question {currentStep + 1} of {questions.length}
          </p>
        </div>
        
        <div className="p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl p-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800 mb-2">
                      {currentQuestion?.question}
                    </h3>
                  </div>
                </div>
              </div>
              
              {renderQuestion()}
            </motion.div>
          </AnimatePresence>
          
          <div className="flex justify-between mt-8">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 0}
              className="h-12 px-6 rounded-2xl"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              Back
            </Button>
            
            <Button
              onClick={handleNext}
              disabled={!currentAnswer.trim()}
              className="h-12 px-8 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600"
            >
              {isLastQuestion ? (
                <>
                  <Check className="w-5 h-5 mr-2" />
                  Complete Activity
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-5 h-5 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}