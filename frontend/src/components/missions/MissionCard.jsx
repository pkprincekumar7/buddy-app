import { motion } from 'framer-motion';
import { Check, ChevronRight } from 'lucide-react';
import PillarIcon, { pillarConfig } from '../shared/PillarIcon';

export default function MissionCard({ mission, onComplete, onView, isChildMode = false }) {
  const config = pillarConfig[mission.pillar] || pillarConfig.cognitive;
  const isCompleted = mission.status === 'completed';
  
  const difficultyStars = {
    easy: '⭐',
    medium: '⭐⭐',
    challenging: '⭐⭐⭐'
  };
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      whileHover={{ scale: 1.01 }}
      className={`relative overflow-hidden rounded-3xl border-2 transition-all duration-300 ${
        isCompleted 
          ? 'border-emerald-200 bg-emerald-50/50' 
          : `${config.borderColor} bg-white`
      }`}
    >
      {/* Completed badge */}
      {isCompleted && (
        <div className="absolute top-3 right-3 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg">
          <Check className="w-5 h-5 text-white" />
        </div>
      )}
      
      <div className="p-5">
        <div className="flex items-start gap-4">
          <PillarIcon pillar={mission.pillar} size="md" />
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.bgColor} ${config.color}`}>
                {config.label}
              </span>
              <span className="text-xs text-slate-400">
                {difficultyStars[mission.difficulty] || '⭐'}
              </span>
            </div>
            
            <h3 className={`font-semibold mb-1 ${isCompleted ? 'text-emerald-700' : 'text-slate-800'}`}>
              {mission.title}
            </h3>
            
            <p className="text-sm text-slate-500 line-clamp-2">
              {mission.description}
            </p>
          </div>
        </div>
        
        {/* Actions */}
        {!isCompleted && (
          <div className="mt-4 flex items-center gap-3">
            {isChildMode ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onComplete}
                className={`flex-1 py-3 px-4 rounded-2xl bg-gradient-to-r ${config.gradientFrom} ${config.gradientTo} text-white font-semibold text-sm shadow-lg shadow-slate-200 flex items-center justify-center gap-2`}
              >
                Start Mission 🎮
              </motion.button>
            ) : (
              <>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onView}
                  className="flex-1 py-2.5 px-4 rounded-xl border-2 border-slate-200 text-slate-700 font-medium text-sm hover:bg-slate-50 flex items-center justify-center gap-1"
                >
                  Details <ChevronRight className="w-4 h-4" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onComplete}
                  className="py-2.5 px-4 rounded-xl bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 flex items-center gap-1"
                >
                  <Check className="w-4 h-4" /> Complete
                </motion.button>
              </>
            )}
          </div>
        )}
        
        {/* In Progress Indicator */}
        {mission.status === 'in_progress' && isChildMode && (
          <div className="mt-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-sm text-amber-700 font-medium">🎮 Continue playing...</p>
          </div>
        )}
        
        {/* Completed - needs parent observation */}
        {isCompleted && mission.child_responses && mission.child_responses.length > 0 && !mission.ai_insights && !isChildMode && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={onView}
            className="mt-4 w-full py-2.5 px-4 rounded-xl border-2 border-purple-300 bg-purple-50 text-purple-600 font-medium text-sm hover:bg-purple-100 transition-colors"
          >
            ✨ View child's responses & add insights
          </motion.button>
        )}
        
        {/* Completed with insights */}
        {isCompleted && mission.ai_insights && !isChildMode && (
          <div className="mt-4 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-sm text-emerald-700 font-medium">✅ Completed with insights</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}