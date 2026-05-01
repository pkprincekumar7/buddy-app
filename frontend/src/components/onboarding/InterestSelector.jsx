import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const interests = [
  { id: 'reading', label: 'Reading', emoji: '📚', pillar: 'cognitive' },
  { id: 'math', label: 'Math & Numbers', emoji: '🔢', pillar: 'cognitive' },
  { id: 'science', label: 'Science', emoji: '🔬', pillar: 'cognitive' },
  { id: 'art', label: 'Art & Drawing', emoji: '🎨', pillar: 'talent' },
  { id: 'music', label: 'Music', emoji: '🎵', pillar: 'talent' },
  { id: 'sports', label: 'Sports', emoji: '⚽', pillar: 'physical' },
  { id: 'dance', label: 'Dance', emoji: '💃', pillar: 'physical' },
  { id: 'coding', label: 'Coding & Tech', emoji: '💻', pillar: 'future' },
  { id: 'nature', label: 'Nature & Animals', emoji: '🌿', pillar: 'character' },
  { id: 'cooking', label: 'Cooking', emoji: '👨‍🍳', pillar: 'talent' },
  { id: 'building', label: 'Building Things', emoji: '🧱', pillar: 'cognitive' },
  { id: 'writing', label: 'Writing Stories', emoji: '✍️', pillar: 'talent' },
  { id: 'games', label: 'Board Games', emoji: '🎲', pillar: 'cognitive' },
  { id: 'helping', label: 'Helping Others', emoji: '🤝', pillar: 'character' },
  { id: 'exploring', label: 'Exploring', emoji: '🗺️', pillar: 'future' },
  { id: 'photography', label: 'Photography', emoji: '📷', pillar: 'talent' }
];

export default function InterestSelector({ selected = [], onToggle }) {
  return (
    <div className="space-y-4">
      <p className="text-center text-slate-500 text-sm">
        What does your child enjoy? Select all that apply.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {interests.map((interest, index) => {
          const isSelected = selected.includes(interest.id);
          
          return (
            <motion.button
              key={interest.id}
              onClick={() => onToggle(interest.id)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.02 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className={`relative p-4 rounded-2xl border-2 transition-all duration-200 flex flex-col items-center gap-2 ${
                isSelected
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <span className="text-3xl">{interest.emoji}</span>
              <span className={`text-sm font-medium text-center ${isSelected ? 'text-purple-700' : 'text-slate-700'}`}>
                {interest.label}
              </span>
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
    </div>
  );
}

export { interests };