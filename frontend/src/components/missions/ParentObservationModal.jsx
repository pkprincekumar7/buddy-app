import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles } from 'lucide-react';

export default function ParentObservationModal({ mission, childResponses, onSubmit, onCancel, isGenerating }) {
  const [observation, setObservation] = useState('');
  
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 p-6 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-slate-800">Add Your Observation</h2>
            <button
              onClick={onCancel}
              className="text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          <p className="text-slate-500 mt-2">
            Share what you noticed about {mission.child_name || 'your child'} during this activity
          </p>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Child's Responses Summary */}
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl p-6 border border-purple-200">
            <h3 className="font-semibold text-purple-800 mb-3 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              {mission.child_name}'s Mini-Game Responses
            </h3>
            <div className="space-y-3">
              {childResponses?.map((response, i) => (
                <div key={i} className="bg-white rounded-xl p-3 border border-purple-100">
                  <p className="text-sm text-purple-600 font-medium mb-1">Q{i + 1}: {response.question}</p>
                  <p className="text-slate-800 font-medium">{response.answer}</p>
                </div>
              ))}
            </div>
            
            {/* Show reflection and learning areas if available */}
            {mission.reflection && (
              <div className="mt-4 p-4 bg-white rounded-xl border border-purple-100">
                <p className="text-sm text-purple-600 font-semibold mb-2">💭 Reflection:</p>
                <p className="text-slate-800">{mission.reflection}</p>
              </div>
            )}
            
            {mission.learning_areas && (
              <div className="mt-4 p-4 bg-white rounded-xl border border-purple-100">
                <p className="text-sm text-purple-600 font-semibold mb-2">📚 Wants to Learn:</p>
                <p className="text-slate-800">{mission.learning_areas}</p>
              </div>
            )}
          </div>
          
          {/* Parent Observation Input */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Your Observation
            </label>
            <Textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="What did you notice? How did they approach the activity? Any interesting moments or behaviors?"
              className="min-h-[150px] rounded-2xl"
            />
            <p className="text-xs text-slate-500 mt-2">
              This will be combined with your child's responses to generate personalized insights
            </p>
          </div>
          
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isGenerating}
              className="h-12 px-6 rounded-2xl"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onSubmit(observation)}
              disabled={!observation.trim() || isGenerating}
              className="h-12 px-8 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating Insights...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Generate Insights
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}