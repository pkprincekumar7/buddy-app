import { motion } from 'framer-motion';
import { Sparkles, TrendingUp, Lightbulb, Target } from 'lucide-react';

export default function MissionInsightsCard({ mission }) {
  if (!mission.ai_insights) return null;

  const { summary, strengths_observed, growth_opportunities, recommendations } = mission.ai_insights;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-3xl p-6 border-2 border-purple-200"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="font-bold text-purple-900">Mission Insights</h3>
          <p className="text-sm text-purple-600">{mission.title}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-6 p-4 bg-white rounded-2xl border border-purple-100">
        <p className="text-slate-700 leading-relaxed">{summary}</p>
      </div>

      {/* Strengths Observed */}
      {strengths_observed && strengths_observed.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            <h4 className="font-semibold text-slate-800">Strengths Observed</h4>
          </div>
          <div className="space-y-2">
            {strengths_observed.map((strength, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <span className="text-emerald-500 font-bold">✓</span>
                <p className="text-sm text-slate-700">{strength}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Growth Opportunities */}
      {growth_opportunities && growth_opportunities.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-5 h-5 text-amber-600" />
            <h4 className="font-semibold text-slate-800">Growth Opportunities</h4>
          </div>
          <div className="space-y-2">
            {growth_opportunities.map((opportunity, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
                <span className="text-amber-500 font-bold">→</span>
                <p className="text-sm text-slate-700">{opportunity}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-blue-600" />
            <h4 className="font-semibold text-slate-800">Recommendations</h4>
          </div>
          <div className="space-y-2">
            {recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
                <span className="text-blue-500 font-bold">{i + 1}.</span>
                <p className="text-sm text-slate-700">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}