import { motion } from 'framer-motion';
import { MapPin, Flag, Star } from 'lucide-react';

const phases = [
  {
    id: 'foundation',
    name: 'Foundation',
    ages: '9-11',
    color: 'from-teal-400 to-emerald-500',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    description: 'Building core habits, discovering interests, and developing self-awareness',
    milestones: ['Strong daily routines', 'Identified key interests', 'Basic emotional vocabulary']
  },
  {
    id: 'exploration',
    name: 'Exploration',
    ages: '12-14',
    color: 'from-purple-400 to-indigo-500',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    description: 'Deepening skills, trying new experiences, and building confidence',
    milestones: ['Developed 2-3 skills', 'Expanded social circle', 'Growing independence']
  },
  {
    id: 'direction',
    name: 'Direction',
    ages: '15-17',
    color: 'from-amber-400 to-orange-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    description: 'Clarifying purpose, making decisions, and preparing for the future',
    milestones: ['Clear strengths profile', 'Future vision emerging', 'Ready for next chapter']
  }
];

export default function GrowthRoadmap({ currentPhase = 'foundation', childAge }) {
  const currentPhaseIndex = phases.findIndex(p => p.id === currentPhase);
  
  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">Growth Journey</h3>
          <p className="text-sm text-slate-500">A 9-year path to becoming</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full">
          <span className="text-sm font-medium text-slate-600">Age</span>
          <span className="text-sm font-bold text-slate-800">{childAge || '?'}</span>
        </div>
      </div>
      
      {/* Timeline */}
      <div className="relative">
        {/* Connection line */}
        <div className="absolute left-6 top-12 bottom-12 w-1 bg-slate-200 rounded-full" />
        <motion.div 
          className="absolute left-6 top-12 w-1 bg-gradient-to-b from-teal-400 to-emerald-500 rounded-full"
          initial={{ height: 0 }}
          animate={{ height: `${((currentPhaseIndex + 1) / phases.length) * 100}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          style={{ maxHeight: 'calc(100% - 96px)' }}
        />
        
        <div className="space-y-6">
          {phases.map((phase, index) => {
            const isCurrent = phase.id === currentPhase;
            const isPast = index < currentPhaseIndex;
            const isFuture = index > currentPhaseIndex;
            
            return (
              <motion.div
                key={phase.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.2 }}
                className={`relative pl-16 ${isFuture ? 'opacity-50' : ''}`}
              >
                {/* Phase marker */}
                <div className={`absolute left-0 w-12 h-12 rounded-2xl flex items-center justify-center border-2 transition-all duration-500 ${
                  isCurrent 
                    ? `bg-gradient-to-br ${phase.color} border-transparent shadow-lg` 
                    : isPast 
                      ? 'bg-emerald-500 border-emerald-500' 
                      : `${phase.bgColor} ${phase.borderColor}`
                }`}>
                  {isPast ? (
                    <Star className="w-5 h-5 text-white fill-white" />
                  ) : isCurrent ? (
                    <MapPin className="w-5 h-5 text-white" />
                  ) : (
                    <Flag className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                
                {/* Phase content */}
                <div className={`p-4 rounded-2xl border-2 transition-all ${
                  isCurrent 
                    ? `${phase.bgColor} ${phase.borderColor} shadow-md` 
                    : 'border-transparent hover:bg-slate-50'
                }`}>
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className={`font-bold ${isCurrent ? 'text-slate-800' : 'text-slate-600'}`}>
                      {phase.name}
                    </h4>
                    <span className="text-xs px-2 py-0.5 bg-slate-100 rounded-full text-slate-500">
                      Ages {phase.ages}
                    </span>
                    {isCurrent && (
                      <span className="text-xs px-2 py-0.5 bg-emerald-500 text-white rounded-full font-medium">
                        Current
                      </span>
                    )}
                  </div>
                  
                  <p className="text-sm text-slate-500 mb-3">{phase.description}</p>
                  
                  {isCurrent && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Phase Goals</p>
                      <div className="flex flex-wrap gap-2">
                        {phase.milestones.map((milestone, i) => (
                          <span 
                            key={i}
                            className="text-xs px-2.5 py-1 bg-white rounded-full text-slate-600 border border-slate-200"
                          >
                            {milestone}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}