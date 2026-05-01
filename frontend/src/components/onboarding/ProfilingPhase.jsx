import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, MessageCircle } from 'lucide-react';

const profilingQuestions = [
  {
    field: 'learning_style',
    question: "How does {name} learn best?",
    subtext: "Think about when they really 'get' something",
    options: [
      { value: 'visual', label: '👁️ Watching & Seeing', desc: 'Videos, diagrams, demonstrations' },
      { value: 'auditory', label: '👂 Listening & Discussing', desc: 'Explanations, conversations, podcasts' },
      { value: 'reading', label: '📖 Reading & Writing', desc: 'Books, notes, written instructions' },
      { value: 'hands-on', label: '🤲 Doing & Experimenting', desc: 'Hands-on activities, trial and error' }
    ]
  },
  {
    field: 'energy_level',
    question: "How would you describe {name}'s energy?",
    subtext: "Their natural activity level",
    options: [
      { value: 'high', label: '⚡ Always on the Go', desc: 'High energy, loves activity' },
      { value: 'moderate', label: '🌊 Steady & Balanced', desc: 'Good balance of active and calm' },
      { value: 'calm', label: '🌸 Calm & Thoughtful', desc: 'Prefers quieter activities' },
      { value: 'variable', label: '🎭 Changes Often', desc: 'Energy varies by interest' }
    ]
  },
  {
    field: 'attention_span',
    question: "When {name} is interested in something...",
    subtext: "Their focus and engagement style",
    options: [
      { value: 'deep-focus', label: '🎯 Deep Focus', desc: 'Can concentrate for long periods' },
      { value: 'varied', label: '🦋 Likes Variety', desc: 'Prefers switching between activities' },
      { value: 'project-based', label: '🏗️ Project-Oriented', desc: 'Great focus on meaningful projects' },
      { value: 'guided', label: '🤝 Needs Guidance', desc: 'Works best with structure' }
    ]
  }
];

export default function ProfilingPhase({ data, updateData }) {
  const [currentQuestion, setCurrentQuestion] = useState(0);

  const getQuestion = (text) => {
    return text.replace(/{name}/g, data.name || 'your child');
  };

  const handleSelect = (field, value) => {
    updateData({ [field]: value });
    setTimeout(() => {
      if (currentQuestion < profilingQuestions.length - 1) {
        setCurrentQuestion(prev => prev + 1);
      }
    }, 300);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center">
          <Search className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Understanding {data.name}</h2>
        <p className="text-slate-500">Help us understand how they naturally operate</p>
      </div>

      {/* Question */}
      <div className="max-w-xl mx-auto">
        <motion.div
          key={currentQuestion}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Question bubble */}
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="bg-slate-100 rounded-2xl rounded-tl-md px-5 py-4">
                <p className="text-lg text-slate-800 font-medium">
                  {getQuestion(profilingQuestions[currentQuestion].question)}
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  {getQuestion(profilingQuestions[currentQuestion].subtext)}
                </p>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="grid gap-3 pl-13">
            {profilingQuestions[currentQuestion].options.map((option, index) => {
              const isSelected = data[profilingQuestions[currentQuestion].field] === option.value;
              return (
                <motion.button
                  key={option.value}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  onClick={() => handleSelect(profilingQuestions[currentQuestion].field, option.value)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{option.label.split(' ')[0]}</span>
                    <div>
                      <p className={`font-medium ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                        {option.label.split(' ').slice(1).join(' ')}
                      </p>
                      <p className="text-sm text-slate-500">{option.desc}</p>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Progress */}
      <div className="flex justify-center gap-2 pt-4">
        {profilingQuestions.map((q, index) => (
          <button
            key={index}
            onClick={() => data[q.field] && setCurrentQuestion(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentQuestion 
                ? 'w-6 bg-blue-500' 
                : data[q.field]
                  ? 'bg-blue-300' 
                  : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
    </div>
  );
}