import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const traits = [
  { id: 'curious', label: 'Curious', emoji: '🔍' },
  { id: 'creative', label: 'Creative', emoji: '🎨' },
  { id: 'social', label: 'Social', emoji: '👋' },
  { id: 'thoughtful', label: 'Thoughtful', emoji: '💭' },
  { id: 'active', label: 'Active', emoji: '⚡' },
  { id: 'caring', label: 'Caring', emoji: '💕' },
  { id: 'determined', label: 'Determined', emoji: '💪' },
  { id: 'imaginative', label: 'Imaginative', emoji: '✨' },
  { id: 'organized', label: 'Organized', emoji: '📋' },
  { id: 'adventurous', label: 'Adventurous', emoji: '🌟' },
  { id: 'patient', label: 'Patient', emoji: '🧘' },
  { id: 'funny', label: 'Funny', emoji: '😄' }
];

export default function PersonalitySelector({ selected = [], onToggle, maxSelect = 5 }) {
  return (
    <div className="space-y-4">
      <p className="text-center text-slate-500 text-sm">
        Select up to {maxSelect} traits that best describe your child
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {traits.map((trait, index) => {
          const isSelected = selected.includes(trait.id);
          const isDisabled = !isSelected && selected.length >= maxSelect;
          
          return (
            <motion.button
              key={trait.id}
              onClick={() => !isDisabled && onToggle(trait.id)}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.03 }}
              whileHover={!isDisabled ? { scale: 1.03 } : {}}
              whileTap={!isDisabled ? { scale: 0.97 } : {}}
              disabled={isDisabled}
              className={`relative p-3 rounded-2xl border-2 transition-all duration-200 flex items-center gap-2 ${
                isSelected
                  ? 'border-teal-500 bg-teal-50'
                  : isDisabled
                    ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
                    : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <span className="text-xl">{trait.emoji}</span>
              <span className={`text-sm font-medium ${isSelected ? 'text-teal-700' : 'text-slate-700'}`}>
                {trait.label}
              </span>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-teal-500 rounded-full flex items-center justify-center"
                >
                  <Check className="w-3 h-3 text-white" />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>
      <div className="text-center">
        <span className="text-sm text-slate-400">
          {selected.length} of {maxSelect} selected
        </span>
      </div>
    </div>
  );
}

export { traits };