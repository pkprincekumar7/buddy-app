import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const values = [
  { id: 'kindness', label: 'Kindness', description: 'Being caring and considerate', icon: '💝' },
  { id: 'honesty', label: 'Honesty', description: 'Being truthful and trustworthy', icon: '🌟' },
  { id: 'respect', label: 'Respect', description: 'Valuing others and self', icon: '🙏' },
  { id: 'responsibility', label: 'Responsibility', description: 'Owning actions and duties', icon: '⚡' },
  { id: 'perseverance', label: 'Perseverance', description: 'Never giving up', icon: '💪' },
  { id: 'gratitude', label: 'Gratitude', description: 'Being thankful', icon: '🙌' },
  { id: 'courage', label: 'Courage', description: 'Facing fears bravely', icon: '🦁' },
  { id: 'empathy', label: 'Empathy', description: 'Understanding others', icon: '❤️' },
  { id: 'curiosity', label: 'Curiosity', description: 'Love of learning', icon: '🔍' },
  { id: 'creativity', label: 'Creativity', description: 'Original thinking', icon: '🎨' },
  { id: 'service', label: 'Service', description: 'Helping community', icon: '🤲' },
  { id: 'balance', label: 'Balance', description: 'Harmony in life', icon: '☯️' }
];

export default function ValuesSelector({ selected = [], onToggle, maxSelect = 5 }) {
  return (
    <div className="space-y-4">
      <p className="text-center text-slate-500 text-sm">
        Select up to {maxSelect} core values that are important to your family
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {values.map((value, index) => {
          const isSelected = selected.includes(value.id);
          const isDisabled = !isSelected && selected.length >= maxSelect;
          
          return (
            <motion.button
              key={value.id}
              onClick={() => !isDisabled && onToggle(value.id)}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.03 }}
              whileHover={!isDisabled ? { scale: 1.02 } : {}}
              whileTap={!isDisabled ? { scale: 0.98 } : {}}
              disabled={isDisabled}
              className={`relative p-4 rounded-2xl border-2 transition-all duration-200 flex items-start gap-3 text-left ${
                isSelected
                  ? 'border-amber-500 bg-amber-50'
                  : isDisabled
                    ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
                    : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <span className="text-2xl flex-shrink-0">{value.icon}</span>
              <div>
                <h4 className={`font-semibold ${isSelected ? 'text-amber-700' : 'text-slate-800'}`}>
                  {value.label}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">{value.description}</p>
              </div>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center"
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

export { values };