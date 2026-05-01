import { motion } from 'framer-motion';
import PillarIcon, { pillarConfig } from '../shared/PillarIcon';

export default function PillarProgress({ pillarScores = {} }) {
  const pillars = Object.keys(pillarConfig);
  
  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200">
      <h3 className="font-bold text-slate-800 text-lg mb-6">Growth Pillars</h3>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {pillars.map((pillar, index) => {
          const config = pillarConfig[pillar];
          const score = pillarScores[pillar] || 0;
          
          return (
            <motion.div
              key={pillar}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`relative p-4 rounded-2xl ${config.bgColor} border ${config.borderColor} hover:shadow-md transition-shadow`}
            >
              <div className="flex flex-col items-center">
                <PillarIcon pillar={pillar} size="md" />
                <h4 className={`font-semibold text-sm mt-2 ${config.color}`}>{config.label}</h4>
                
                {/* Progress ring */}
                <div className="relative w-16 h-16 mt-3">
                  <svg className="w-16 h-16 transform -rotate-90">
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="6"
                      className="text-white"
                    />
                    <motion.circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="6"
                      strokeLinecap="round"
                      className={config.color}
                      initial={{ strokeDasharray: "0 176" }}
                      animate={{ strokeDasharray: `${(score / 100) * 176} 176` }}
                      transition={{ duration: 1, ease: "easeOut", delay: index * 0.1 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-lg font-bold ${config.color}`}>{score}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
      
      {/* Overall score */}
      <div className="mt-6 pt-6 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Overall Growth Score</p>
            <p className="text-3xl font-bold text-slate-800">
              {Math.round(Object.values(pillarScores).reduce((a, b) => a + (b || 0), 0) / 6)}
              <span className="text-lg text-slate-400 font-normal">/100</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Growth Trend</p>
            <p className="text-lg font-semibold text-emerald-600">↑ Improving</p>
          </div>
        </div>
      </div>
    </div>
  );
}