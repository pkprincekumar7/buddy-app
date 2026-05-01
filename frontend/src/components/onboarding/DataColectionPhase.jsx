import { useState } from 'react';
import { motion } from 'framer-motion';
import { Input } from "@/components/ui/input";
import { Heart, MessageCircle } from 'lucide-react';

const conversationSteps = [
  { field: 'name', question: "Hi there! 👋 I'm excited to help your family on this journey. First, what's your child's name?", placeholder: "Enter their name" },
  { field: 'date_of_birth', question: "Wonderful! When was {name} born?", placeholder: "", type: "date" },
  { field: 'gender', question: "And {name} is a...", options: ['Boy', 'Girl', 'Prefer not to say'] },
  { field: 'school_grade', question: "What grade is {name} currently in?", placeholder: "e.g., 4th grade, Year 5" }
];

export default function DataCollectionPhase({ data, updateData }) {
  const [currentStep, setCurrentStep] = useState(0);
  
  const getQuestion = (step) => {
    return step.question.replace(/{name}/g, data.name || 'your child');
  };

  const handleInputChange = (field, value) => {
    updateData({ [field]: value });
    
    // Auto-advance for certain fields
    if (field === 'gender') {
      setTimeout(() => {
        if (currentStep < conversationSteps.length - 1) {
          setCurrentStep(prev => prev + 1);
        }
      }, 300);
    }
  };

  const handleKeyPress = (e, field) => {
    if (e.key === 'Enter' && data[field]) {
      if (currentStep < conversationSteps.length - 1) {
        setCurrentStep(prev => prev + 1);
      }
    }
  };

  const step = conversationSteps[currentStep];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
          <Heart className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Let's Get to Know Your Child</h2>
        <p className="text-slate-500">A quick conversation to start the journey</p>
      </div>

      {/* Conversation History */}
      <div className="space-y-6 max-w-lg mx-auto">
        {conversationSteps.slice(0, currentStep + 1).map((s, index) => (
          <motion.div
            key={s.field}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index === currentStep ? 0.2 : 0 }}
            className="space-y-3"
          >
            {/* Question Bubble */}
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-4 h-4 text-teal-600" />
              </div>
              <div className="bg-slate-100 rounded-2xl rounded-tl-md px-4 py-3 max-w-[85%]">
                <p className="text-slate-700">{getQuestion(s)}</p>
              </div>
            </div>

            {/* Answer */}
            {index < currentStep ? (
              <div className="flex justify-end">
                <div className="bg-teal-500 text-white rounded-2xl rounded-tr-md px-4 py-3 max-w-[85%]">
                  <p>{data[s.field]}</p>
                </div>
              </div>
            ) : (
              <div className="pl-11">
                {s.options ? (
                  <div className="flex flex-wrap gap-2">
                    {s.options.map(option => (
                      <motion.button
                        key={option}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleInputChange(s.field, option)}
                        className={`px-4 py-2 rounded-xl border-2 transition-all ${
                          data[s.field] === option
                            ? 'border-teal-500 bg-teal-50 text-teal-700'
                            : 'border-slate-200 hover:border-slate-300 text-slate-600'
                        }`}
                      >
                        {option}
                      </motion.button>
                    ))}
                  </div>
                ) : (
                  <Input
                    type={s.type || 'text'}
                    value={data[s.field] || ''}
                    onChange={(e) => handleInputChange(s.field, e.target.value)}
                    onKeyPress={(e) => handleKeyPress(e, s.field)}
                    placeholder={s.placeholder}
                    className="h-12 rounded-xl border-slate-200 focus:border-teal-500 focus:ring-teal-500"
                    autoFocus={index === currentStep}
                  />
                )}
                
                {data[s.field] && !s.options && currentStep === index && (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => currentStep < conversationSteps.length - 1 && setCurrentStep(prev => prev + 1)}
                    className="mt-2 text-sm text-teal-600 hover:text-teal-700 font-medium"
                  >
                    Press Enter or click here to continue →
                  </motion.button>
                )}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-2 pt-4">
        {conversationSteps.map((_, index) => (
          <button
            key={index}
            onClick={() => index <= currentStep && setCurrentStep(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentStep 
                ? 'w-6 bg-teal-500' 
                : index < currentStep 
                  ? 'bg-teal-300' 
                  : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
    </div>
  );
}