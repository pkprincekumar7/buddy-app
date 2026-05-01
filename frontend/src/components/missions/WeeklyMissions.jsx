import { motion, AnimatePresence } from 'framer-motion';
import MissionCard from './MissionCard';

export default function WeeklyMissions({ missions = [], onCompleteMission, onViewMission, isChildMode = false }) {
  const activeMissions = missions.filter(m => m.status === 'active');
  const completedMissions = missions.filter(m => m.status === 'completed');
  const completionRate = missions.length > 0 ? (completedMissions.length / missions.length) * 100 : 0;
  
  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-slate-800">This Week's Progress</h3>
            <p className="text-sm text-slate-500">{completedMissions.length} of {missions.length} missions complete</p>
          </div>
          <div className="text-2xl font-bold text-emerald-600">
            {Math.round(completionRate)}%
          </div>
        </div>
        
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${completionRate}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
        
        {completionRate === 100 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 text-center py-3 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-2xl border border-amber-200"
          >
            <span className="text-xl mr-2">🎉</span>
            <span className="font-semibold text-amber-700">Amazing week! All missions complete!</span>
          </motion.div>
        )}
      </div>
      
      {/* Active missions */}
      {activeMissions.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-semibold text-slate-700 px-1">Active Missions</h4>
          <div className="grid gap-4 md:grid-cols-2">
            <AnimatePresence mode="popLayout">
              {activeMissions.map(mission => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  onComplete={() => onCompleteMission(mission)}
                  onView={() => onViewMission(mission)}
                  isChildMode={isChildMode}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
      
      {/* Completed missions */}
      {completedMissions.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-semibold text-slate-700 px-1">Completed ✓</h4>
          <div className="grid gap-4 md:grid-cols-2">
            <AnimatePresence>
              {completedMissions.map(mission => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  onComplete={() => {}}
                  onView={() => onViewMission(mission)}
                  isChildMode={isChildMode}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}