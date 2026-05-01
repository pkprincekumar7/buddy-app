import { useState } from 'react';
import { motion } from 'framer-motion';
import { Star, Check, MessageCircle } from 'lucide-react';

const personalityTraits = [
  { id: 'curious', label: 'Curious', emoji: '🔍' },
  { id: 'creative', label: 'Creative', emoji: '🎨' },
  { id: 'determined', label: 'Determined', emoji: '💪' },
  { id: 'empathetic', label: 'Empathetic', emoji: '💕' },
  { id: 'adventurous', label: 'Adventurous', emoji: '🌟' },
  { id: 'thoughtful', label: 'Thoughtful', emoji: '💭' },
  { id: 'social', label: 'Social', emoji: '👋' },
  { id: 'independent', label: 'Independent', emoji: '🦅' },
  { id: 'patient', label: 'Patient', emoji: '🧘' },
  { id: 'enthusiastic', label: 'Enthusiastic', emoji: '🎉' }
];

const strengthAreas = [
  { id: 'problem-solving', label: 'Problem Solving', emoji: '🧩' },
  { id: 'communication', label: 'Communication', emoji: '💬' },
  { id: 'leadership', label: 'Leadership', emoji: '👑' },
  { id: 'creativity', label: 'Creative Thinking', emoji: '💡' },
  { id: 'athletics', label: 'Physical/Athletic', emoji: '⚽' },
  { id: 'music', label: 'Music/Rhythm', emoji: '🎵' },
  { id: 'art', label: 'Visual Arts', emoji: '🖼️' },
  { id: 'logic', label: 'Logic/Math', emoji: '🔢' },
  { id: 'empathy', label: 'Understanding Others', emoji: '🤝' },
  { id: 'focus', label: 'Deep Focus', emoji: '🎯' }
];

const interests = [
  { id: 'reading', label: 'Reading', emoji: '📚' },
  { id: 'sports', label: 'Sports', emoji: '🏃' },
  { id: 'music', label: 'Music', emoji: '🎵' },
  { id: 'art', label: 'Art & Crafts', emoji: '🎨' },
  { id: 'science', label: 'Science', emoji: '🔬' },
  { id: 'technology', label: 'Technology', emoji: '💻' },
  { id: 'nature', label: 'Nature', emoji: '🌿' },
  { id: 'building', label: 'Building Things', emoji: '🧱' },
  { id: 'animals', label: 'Animals', emoji: '🐾' },
  { id: 'cooking', label: 'Cooking', emoji: '👨‍🍳' },
  { id: 'games', label: 'Games & Puzzles', emoji: '🎲' },
  { id: 'writing', label: 'Writing', emoji: '✍️' }
];

const challenges = [
  { id: 'focus', label: 'Staying Focused', emoji: '🎯' },
  { id: 'patience', label: 'Being Patient', emoji: '⏳' },
  { id: 'social', label: 'Making Friends', emoji: '👥' },
  { id: 'confidence', label: 'Self-Confidence', emoji: '💪' },
  { id: 'organization', label: 'Staying Organized', emoji: '📋' },
  { id: 'emotions', label: 'Managing Emotions', emoji: '🎭' },
  { id: 'trying-new', label: 'Trying New Things', emoji: '🌟' },
  { id: 'failure', label: 'Handling Setbacks', emoji: '🔄' }
];

export default function PersonalityPhase({ data, updateData }) {
  const [section, setSection] = useState(0);
  
  const sections = [
    { title: 'Personality Traits', subtitle: `What words describe ${data.name}?`, field: 'personality_traits', items: personalityTraits, max: 5 },
    { title: 'Natural Strengths', subtitle: `Where does ${data.name} shine?`, field: 'observed_strengths', items: strengthAreas, max: 4 },
    { title: 'Interests', subtitle: `What does ${data.name} enjoy?`, field: 'interests', items: interests, max: 6 },
    { title: 'Growth Areas', subtitle: `Where could ${data.name} use support?`, field: 'challenges', items: challenges, max: 3 }
  ];

  const currentSection = sections[section];
  const selectedItems = data[currentSection.field] || [];

  const toggleItem = (id) => {
    const current = data[currentSection.field] || [];
    if (current.includes(id)) {
      updateData({ [currentSection.field]: current.filter(i => i !== id) });
    } else if (current.length < currentSection.max) {
      updateData({ [currentSection.field]: [...current, id] });
    }
  };

  const canAdvance = selectedItems.length >= 2;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <Star className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Personality & Strengths</h2>
        <p className="text-slate-500">Let's discover what makes {data.name} unique</p>
      </div>

      {/* Question bubble */}
      <div className="max-w-xl mx-auto">
        <div className="flex gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <MessageCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="bg-slate-100 rounded-2xl rounded-tl-md px-5 py-4">
            <p className="text-lg text-slate-800 font-medium">{currentSection.title}</p>
            <p className="text-sm text-slate-500">{currentSection.subtitle}</p>
            <p className="text-xs text-amber-600 mt-2">Select up to {currentSection.max} (minimum 2)</p>
          </div>
        </div>
      </div>

      {/* Selection Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
        {currentSection.items.map((item, index) => {
          const isSelected = selectedItems.includes(item.id);
          const isDisabled = !isSelected && selectedItems.length >= currentSection.max;
          
          return (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.03 }}
              onClick={() => !isDisabled && toggleItem(item.id)}
              disabled={isDisabled}
              className={`relative p-3 rounded-2xl border-2 transition-all ${
                isSelected
                  ? 'border-amber-500 bg-amber-50'
                  : isDisabled
                    ? 'border-slate-100 bg-slate-50 opacity-40 cursor-not-allowed'
                    : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <span className="text-2xl block mb-1">{item.emoji}</span>
              <span className={`text-sm font-medium ${isSelected ? 'text-amber-700' : 'text-slate-700'}`}>
                {item.label}
              </span>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center"
                >
                  <Check className="w-3 h-3 text-white" />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Section Progress & Navigation */}
      <div className="flex items-center justify-between max-w-xl mx-auto pt-4">
        <div className="flex gap-2">
          {sections.map((s, index) => (
            <button
              key={index}
              onClick={() => (data[sections[index].field]?.length >= 2 || index <= section) && setSection(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                index === section 
                  ? 'w-6 bg-amber-500' 
                  : (data[s.field]?.length >= 2)
                    ? 'bg-amber-300' 
                    : 'bg-slate-200'
              }`}
            />
          ))}
        </div>
        
        {section < sections.length - 1 && canAdvance && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => setSection(prev => prev + 1)}
            className="text-sm text-amber-600 hover:text-amber-700 font-medium"
          >
            Next: {sections[section + 1].title} →
          </motion.button>
        )}
      </div>

      {/* Selection count */}
      <div className="text-center">
        <span className="text-sm text-slate-400">
          {selectedItems.length} of {currentSection.max} selected
        </span>
      </div>
    </div>
  );
}