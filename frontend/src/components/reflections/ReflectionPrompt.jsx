import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Smile, Trophy, Lightbulb, Heart, Sparkles, Send } from 'lucide-react';
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const reflectionTypes = [
  { id: 'gratitude', icon: Heart, label: 'Gratitude', color: 'text-rose-500', bg: 'bg-rose-50', prompt: "What made you smile today?" },
  { id: 'achievement', icon: Trophy, label: 'Win', color: 'text-amber-500', bg: 'bg-amber-50', prompt: "What did you do well today?" },
  { id: 'learning', icon: Lightbulb, label: 'Learning', color: 'text-blue-500', bg: 'bg-blue-50', prompt: "What did you learn today?" },
  { id: 'feeling', icon: Smile, label: 'Feeling', color: 'text-emerald-500', bg: 'bg-emerald-50', prompt: "How are you feeling?" },
  { id: 'dream', icon: Sparkles, label: 'Dream', color: 'text-purple-500', bg: 'bg-purple-50', prompt: "What do you wish for?" }
];

const moods = [
  { id: 'happy', emoji: '😊', label: 'Happy' },
  { id: 'proud', emoji: '😎', label: 'Proud' },
  { id: 'curious', emoji: '🤔', label: 'Curious' },
  { id: 'calm', emoji: '😌', label: 'Calm' },
  { id: 'excited', emoji: '🤩', label: 'Excited' },
  { id: 'thoughtful', emoji: '🧐', label: 'Thoughtful' }
];

export default function ReflectionPrompt({ onSubmit, isLoading = false }) {
  const [selectedType, setSelectedType] = useState(null);
  const [content, setContent] = useState('');
  const [selectedMood, setSelectedMood] = useState(null);
  
  const activeType = reflectionTypes.find(t => t.id === selectedType);
  
  const handleSubmit = () => {
    if (!content.trim() || !selectedType) return;
    onSubmit({
      type: selectedType,
      content: content.trim(),
      mood: selectedMood
    });
    setContent('');
    setSelectedType(null);
    setSelectedMood(null);
  };
  
  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200">
      <h3 className="font-bold text-slate-800 text-lg mb-4">Daily Reflection</h3>
      
      {/* Type selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {reflectionTypes.map((type) => {
          const Icon = type.icon;
          const isSelected = selectedType === type.id;
          
          return (
            <motion.button
              key={type.id}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setSelectedType(type.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-2xl border-2 transition-all ${
                isSelected 
                  ? `${type.bg} border-current ${type.color}` 
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              <Icon className={`w-4 h-4 ${isSelected ? type.color : ''}`} />
              <span className="text-sm font-medium">{type.label}</span>
            </motion.button>
          );
        })}
      </div>
      
      {/* Content input */}
      <AnimatePresence mode="wait">
        {selectedType && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className={`p-4 rounded-2xl ${activeType.bg}`}>
              <p className={`text-sm font-medium ${activeType.color} mb-2`}>
                {activeType.prompt}
              </p>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Type your thoughts here..."
                className="min-h-[100px] border-0 bg-white/70 focus-visible:ring-2 focus-visible:ring-slate-200 rounded-xl resize-none"
              />
            </div>
            
            {/* Mood selector */}
            <div>
              <p className="text-sm text-slate-500 mb-2">How do you feel?</p>
              <div className="flex flex-wrap gap-2">
                {moods.map((mood) => (
                  <motion.button
                    key={mood.id}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setSelectedMood(mood.id)}
                    className={`px-3 py-2 rounded-xl border-2 transition-all flex items-center gap-1.5 ${
                      selectedMood === mood.id
                        ? 'border-slate-800 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-lg">{mood.emoji}</span>
                    <span className="text-xs text-slate-600">{mood.label}</span>
                  </motion.button>
                ))}
              </div>
            </div>
            
            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={!content.trim() || isLoading}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white rounded-2xl h-12"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                  />
                  Saving...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  Save Reflection
                </span>
              )}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {!selectedType && (
        <p className="text-sm text-slate-400 text-center py-4">
          Choose a reflection type above to get started ✨
        </p>
      )}
    </div>
  );
}