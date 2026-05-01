import { motion } from 'framer-motion';
import { Lightbulb, TrendingUp, Award, MessageCircle, Sparkles, ChevronRight } from 'lucide-react';
import { pillarConfig } from '../shared/PillarIcon';

const insightIcons = {
  strength_emerging: Sparkles,
  pattern_detected: TrendingUp,
  milestone_reached: Award,
  conversation_prompt: MessageCircle,
  activity_suggestion: Lightbulb
};

const insightColors = {
  strength_emerging: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-600', icon: 'text-purple-500' },
  pattern_detected: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', icon: 'text-blue-500' },
  milestone_reached: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', icon: 'text-amber-500' },
  conversation_prompt: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-600', icon: 'text-rose-500' },
  activity_suggestion: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600', icon: 'text-emerald-500' }
};

export default function InsightCard({ insight, onAction }) {
  const Icon = insightIcons[insight.insight_type] || Lightbulb;
  const colors = insightColors[insight.insight_type] || insightColors.activity_suggestion;
  const pillar = pillarConfig[insight.related_pillar];
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className={`p-5 rounded-2xl border ${colors.border} ${colors.bg} transition-all`}
    >
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${colors.icon}`} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className={`font-semibold ${colors.text}`}>{insight.title}</h4>
            {pillar && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${pillar.bgColor} ${pillar.color}`}>
                {pillar.label}
              </span>
            )}
          </div>
          
          <p className="text-sm text-slate-600 mb-3">{insight.description}</p>
          
          {insight.action_suggestion && (
            <motion.button
              whileHover={{ x: 4 }}
              onClick={onAction}
              className={`text-sm font-medium ${colors.text} flex items-center gap-1 hover:underline`}
            >
              {insight.action_suggestion}
              <ChevronRight className="w-4 h-4" />
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}