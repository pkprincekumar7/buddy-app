import { motion } from 'framer-motion';
import { Compass, Lightbulb, BookOpen, HandHeart, Sparkles } from 'lucide-react';

const avatars = [
  { id: 'explorer', icon: Compass, label: 'Explorer', color: 'from-teal-400 to-cyan-500', description: 'Loves discovering new things' },
  { id: 'creator', icon: Lightbulb, label: 'Creator', color: 'from-purple-400 to-pink-500', description: 'Makes amazing things' },
  { id: 'thinker', icon: BookOpen, label: 'Thinker', color: 'from-blue-400 to-indigo-500', description: 'Curious about everything' },
  { id: 'helper', icon: HandHeart, label: 'Helper', color: 'from-rose-400 to-orange-500', description: 'Cares about others' },
  { id: 'dreamer', icon: Sparkles, label: 'Dreamer', color: 'from-amber-400 to-yellow-500', description: 'Imagines big possibilities' }
];

export default function AvatarSelector({ selected, onSelect }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {avatars.map((avatar, index) => {
        const Icon = avatar.icon;
        const isSelected = selected === avatar.id;
        
        return (
          <motion.button
            key={avatar.id}
            onClick={() => onSelect(avatar.id)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={`relative p-4 rounded-3xl border-2 transition-all duration-300 ${
              isSelected 
                ? 'border-slate-800 bg-white shadow-xl' 
                : 'border-slate-200 bg-white/50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <div className={`w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br ${avatar.color} flex items-center justify-center mb-3`}>
              <Icon className="w-8 h-8 text-white" />
            </div>
            <h3 className="font-semibold text-slate-800 mb-1">{avatar.label}</h3>
            <p className="text-xs text-slate-500">{avatar.description}</p>
            
            {isSelected && (
              <motion.div
                layoutId="avatar-check"
                className="absolute -top-2 -right-2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center"
              >
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

export { avatars };