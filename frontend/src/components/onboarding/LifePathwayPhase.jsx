import { useState } from 'react';
import { motion } from 'framer-motion';
import { Compass, MessageCircle, Check, Sparkles } from 'lucide-react';
import { Textarea } from "@/components/ui/textarea";

const familyValues = [
  { id: 'kindness', label: 'Kindness', emoji: '💝', desc: 'Being caring and considerate' },
  { id: 'honesty', label: 'Honesty', emoji: '🌟', desc: 'Being truthful' },
  { id: 'perseverance', label: 'Perseverance', emoji: '💪', desc: 'Never giving up' },
  { id: 'curiosity', label: 'Curiosity', emoji: '🔍', desc: 'Love of learning' },
  { id: 'respect', label: 'Respect', emoji: '🙏', desc: 'Valuing others' },
  { id: 'creativity', label: 'Creativity', emoji: '🎨', desc: 'Original thinking' },
  { id: 'responsibility', label: 'Responsibility', emoji: '⚡', desc: 'Owning actions' },
  { id: 'gratitude', label: 'Gratitude', emoji: '🙌', desc: 'Being thankful' },
  { id: 'courage', label: 'Courage', emoji: '🦁', desc: 'Facing fears' },
  { id: 'service', label: 'Service', emoji: '🤲', desc: 'Helping others' },
  { id: 'balance', label: 'Balance', emoji: '☯️', desc: 'Harmony in life' },
  { id: 'faith', label: 'Faith', emoji: '✨', desc: 'Spiritual foundation' }
];

export default function LifePathwayPhase({ data, updateData, profile }) {
  const [step, setStep] = useState(0);
  
  const selectedValues = data.family_values || [];

  const toggleValue = (id) => {
    if (selectedValues.includes(id)) {
      updateData({ family_values: selectedValues.filter(v => v !== id) });
    } else if (selectedValues.length < 5) {
      updateData({ family_values: [...selectedValues, id] });
    }
  };

  const steps = [
    { id: 'values', title: 'Family Values' },
    { id: 'aspirations', title: 'Dreams & Hopes' }
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center">
          <Compass className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Life Journey</h2>
        <p className="text-slate-500">Setting the compass for {data.name}'s journey</p>
      </div>

      {/* Profile Summary (if available) */}
      {profile && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-xl mx-auto bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl p-5 border border-purple-200"
        >
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-purple-500 flex-shrink-0 mt-1" />
            <div>
              <p className="text-sm font-medium text-purple-700 mb-1">Based on what you've shared...</p>
              <p className="text-slate-700">{profile.summary}</p>
            </div>
          </div>
        </motion.div>
      )}

      {step === 0 && (
        <div className="space-y-6">
          {/* Question */}
          <div className="max-w-xl mx-auto">
            <div className="flex gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-5 h-5 text-purple-600" />
              </div>
              <div className="bg-slate-100 rounded-2xl rounded-tl-md px-5 py-4">
                <p className="text-lg text-slate-800 font-medium">What values matter most to your family?</p>
                <p className="text-sm text-slate-500">These will guide {data.name}'s growth journey</p>
                <p className="text-xs text-purple-600 mt-2">Select up to 5 core values</p>
              </div>
            </div>
          </div>

          {/* Values Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
            {familyValues.map((value, index) => {
              const isSelected = selectedValues.includes(value.id);
              const isDisabled = !isSelected && selectedValues.length >= 5;
              
              return (
                <motion.button
                  key={value.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={() => !isDisabled && toggleValue(value.id)}
                  disabled={isDisabled}
                  className={`relative p-3 rounded-2xl border-2 text-left transition-all ${
                    isSelected
                      ? 'border-purple-500 bg-purple-50'
                      : isDisabled
                        ? 'border-slate-100 bg-slate-50 opacity-40 cursor-not-allowed'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="text-2xl block mb-1">{value.emoji}</span>
                  <span className={`text-sm font-medium block ${isSelected ? 'text-purple-700' : 'text-slate-700'}`}>
                    {value.label}
                  </span>
                  <span className="text-xs text-slate-500">{value.desc}</span>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center"
                    >
                      <Check className="w-3 h-3 text-white" />
                    </motion.div>
                  )}
                </motion.button>
              );
            })}
          </div>

          {selectedValues.length >= 2 && (
            <div className="text-center">
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setStep(1)}
                className="text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                Continue to Dreams & Hopes →
              </motion.button>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-6 max-w-xl mx-auto">
          {/* Question */}
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-5 h-5 text-purple-600" />
            </div>
            <div className="bg-slate-100 rounded-2xl rounded-tl-md px-5 py-4 flex-1">
              <p className="text-lg text-slate-800 font-medium">
                What are your hopes and dreams for {data.name}?
              </p>
              <p className="text-sm text-slate-500">
                No pressure - just share what you envision for their future
              </p>
            </div>
          </div>

          <Textarea
            value={data.aspirations || ''}
            onChange={(e) => updateData({ aspirations: e.target.value })}
            placeholder={`I hope ${data.name} will...\n\nI want them to feel...\n\nMy dream for them is...`}
            className="min-h-[150px] rounded-xl border-slate-200 focus:border-purple-500 focus:ring-purple-500"
          />

          {/* Optional: Role models */}
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-5 h-5 text-purple-600" />
              </div>
              <div className="bg-slate-100 rounded-2xl rounded-tl-md px-5 py-4 flex-1">
                <p className="text-slate-800 font-medium">Any role models or inspiring figures?</p>
                <p className="text-sm text-slate-500">Optional - people {data.name} admires</p>
              </div>
            </div>
            
            <Textarea
              value={data.role_models || ''}
              onChange={(e) => updateData({ role_models: e.target.value })}
              placeholder="Family members, historical figures, athletes, artists..."
              className="min-h-[80px] rounded-xl border-slate-200 focus:border-purple-500 focus:ring-purple-500"
            />
          </div>

          <button
            onClick={() => setStep(0)}
            className="text-sm text-slate-500 hover:text-slate-600"
          >
            ← Back to Values
          </button>
        </div>
      )}

      {/* Progress */}
      <div className="flex justify-center gap-2 pt-4">
        {steps.map((s, index) => (
          <button
            key={index}
            onClick={() => setStep(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              index === step ? 'w-6 bg-purple-500' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <div className="text-center">
        <span className="text-sm text-slate-400">
          {selectedValues.length} of 5 values selected
        </span>
      </div>
    </div>
  );
}