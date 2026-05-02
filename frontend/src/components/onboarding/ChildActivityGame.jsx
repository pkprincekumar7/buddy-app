import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, Circle } from 'lucide-react';
import { api } from '@/api/client';
import { toast } from 'sonner';

// Fallback gradient palette shown when an image fails to load.
const TILE_GRADIENTS = [
  'from-purple-400 to-indigo-500',
  'from-rose-400 to-pink-500',
  'from-amber-400 to-orange-500',
  'from-emerald-400 to-teal-500',
  'from-blue-400 to-cyan-500',
  'from-violet-400 to-purple-500',
];

const areaGames = {
  life_ambition: {
    question: "What do you want to become in life?",
    subtitle: "Choose up to 3 options that excite you!",
    maxSelections: 3,
    options: [
      { id: 'astronaut', label: 'Astronaut', emoji: '🚀', image: 'https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?w=400&h=300&fit=crop' },
      { id: 'sports', label: 'Sports Person', emoji: '⚽', image: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=400&h=300&fit=crop' },
      { id: 'parent', label: 'Like My Parents', emoji: '👨‍👩‍👧', image: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400&h=300&fit=crop' },
      { id: 'superhero', label: 'Super Hero', emoji: '🦸', image: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=400&h=300&fit=crop' },
      { id: 'dancer', label: 'Dancer', emoji: '💃', image: 'https://images.unsplash.com/photo-1508700929628-666bc8bd84ea?w=400&h=300&fit=crop' },
      { id: 'scientist', label: 'Scientist', emoji: '🔬', image: 'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=400&h=300&fit=crop' },
    ],
    promptContext: (labels) => `A child has selected these career aspirations: ${labels}. Generate personalized recommendations for the parent to help nurture these interests: 1. A brief summary of what these choices reveal about the child's interests, 2. 3-4 specific activities or experiences to support these aspirations, 3. 2-3 strengths to encourage based on these choices.`
  },
  self_care: {
    question: "Which activities make you feel calm and happy?",
    subtitle: "Pick up to 3 things you enjoy!",
    maxSelections: 3,
    options: [
      { id: 'reading', label: 'Reading', emoji: '📚', image: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&h=300&fit=crop' },
      { id: 'music', label: 'Listening to Music', emoji: '🎵', image: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=400&h=300&fit=crop' },
      { id: 'nature', label: 'Being in Nature', emoji: '🌿', image: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=300&fit=crop' },
      { id: 'drawing', label: 'Drawing / Painting', emoji: '🎨', image: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop' },
      { id: 'sleep', label: 'Resting / Sleeping', emoji: '😴', image: 'https://images.unsplash.com/photo-1520206183501-b80df61043c2?w=400&h=300&fit=crop' },
      { id: 'exercise', label: 'Exercise', emoji: '🏃', image: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=400&h=300&fit=crop' },
    ],
    promptContext: (labels) => `A child has chosen these self-care activities as things that make them feel calm and happy: ${labels}. Generate personalized self-care recommendations for the parent: 1. A brief summary of what these choices reveal about the child's emotional needs, 2. 3-4 specific ways to support these self-care habits at home, 3. 2-3 emotional strengths to encourage.`
  },
  critical_thinking: {
    question: "Which challenges do you enjoy most?",
    subtitle: "Choose up to 3 that sound fun!",
    maxSelections: 3,
    options: [
      { id: 'puzzles', label: 'Solving Puzzles', emoji: '🧩', image: 'https://images.unsplash.com/photo-1606092195730-5d7b9af1efc5?w=400&h=300&fit=crop' },
      { id: 'experiments', label: 'Science Experiments', emoji: '🧪', image: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=400&h=300&fit=crop' },
      { id: 'debates', label: 'Debates & Arguments', emoji: '💬', image: 'https://images.unsplash.com/photo-1573164574572-cb89e39749b4?w=400&h=300&fit=crop' },
      { id: 'strategy', label: 'Strategy Games', emoji: '♟️', image: 'https://images.unsplash.com/photo-1529699211952-734e80c4d42b?w=400&h=300&fit=crop' },
      { id: 'mysteries', label: 'Solving Mysteries', emoji: '🔍', image: 'https://images.unsplash.com/photo-1590012314607-cda9d9b699ae?w=400&h=300&fit=crop' },
      { id: 'inventions', label: 'Inventing Things', emoji: '💡', image: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=400&h=300&fit=crop' },
    ],
    promptContext: (labels) => `A child has chosen these thinking challenges as their favourites: ${labels}. Generate personalized recommendations for the parent to develop their critical thinking: 1. A brief summary of what these choices reveal about the child's thinking style, 2. 3-4 specific activities to sharpen these skills, 3. 2-3 cognitive strengths to encourage.`
  },
  creativity: {
    question: "Which creative activities do you love?",
    subtitle: "Pick up to 3 that spark your imagination!",
    maxSelections: 3,
    options: [
      { id: 'drawing', label: 'Drawing & Art', emoji: '🎨', image: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop' },
      { id: 'storytelling', label: 'Storytelling', emoji: '📖', image: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&h=300&fit=crop' },
      { id: 'music', label: 'Making Music', emoji: '🎸', image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=300&fit=crop' },
      { id: 'building', label: 'Building & Making', emoji: '🏗️', image: 'https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=400&h=300&fit=crop' },
      { id: 'acting', label: 'Acting & Drama', emoji: '🎭', image: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=400&h=300&fit=crop' },
      { id: 'cooking', label: 'Cooking & Baking', emoji: '🍳', image: 'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=400&h=300&fit=crop' },
    ],
    promptContext: (labels) => `A child has chosen these creative activities as their favourites: ${labels}. Generate personalized recommendations for the parent to nurture their creativity: 1. A brief summary of what these choices reveal about the child's creative personality, 2. 3-4 specific ways to encourage and develop these creative skills, 3. 2-3 creative strengths to celebrate.`
  },
  physical_wellness: {
    question: "Which physical activities do you enjoy?",
    subtitle: "Choose up to 3 that get you moving!",
    maxSelections: 3,
    options: [
      { id: 'football', label: 'Football / Soccer', emoji: '⚽', image: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop' },
      { id: 'swimming', label: 'Swimming', emoji: '🏊', image: 'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=400&h=300&fit=crop' },
      { id: 'cycling', label: 'Cycling', emoji: '🚴', image: 'https://images.unsplash.com/photo-1534787238916-9ba6764efd4f?w=400&h=300&fit=crop' },
      { id: 'dancing', label: 'Dancing', emoji: '💃', image: 'https://images.unsplash.com/photo-1508700929628-666bc8bd84ea?w=400&h=300&fit=crop' },
      { id: 'yoga', label: 'Yoga / Stretching', emoji: '🧘', image: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=400&h=300&fit=crop' },
      { id: 'running', label: 'Running', emoji: '🏃', image: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=400&h=300&fit=crop' },
    ],
    promptContext: (labels) => `A child has chosen these physical activities as their favourites: ${labels}. Generate personalized physical wellness recommendations for the parent: 1. A brief summary of what these choices reveal about the child's physical personality, 2. 3-4 specific ways to support and grow these physical habits, 3. 2-3 physical strengths to encourage.`
  },
  social_skills: {
    question: "Which situations feel most natural to you?",
    subtitle: "Choose up to 3 that sound like you!",
    maxSelections: 3,
    options: [
      { id: 'helping', label: 'Helping Others', emoji: '🤝', image: 'https://images.unsplash.com/photo-1559027615-cd4628902d4a?w=400&h=300&fit=crop' },
      { id: 'leading', label: 'Leading a Group', emoji: '👑', image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=300&fit=crop' },
      { id: 'listening', label: 'Listening to Friends', emoji: '👂', image: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=400&h=300&fit=crop' },
      { id: 'teamwork', label: 'Working in a Team', emoji: '🙌', image: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=300&fit=crop' },
      { id: 'making_friends', label: 'Making New Friends', emoji: '😊', image: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=300&fit=crop' },
      { id: 'alone', label: 'Enjoying My Own Time', emoji: '🧸', image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop' },
    ],
    promptContext: (labels) => `A child has identified these social situations as most natural to them: ${labels}. Generate personalized social skills recommendations for the parent: 1. A brief summary of what these choices reveal about the child's social personality, 2. 3-4 specific activities to strengthen their social skills, 3. 2-3 social strengths to celebrate.`
  }
};

function selectionsMatchSubmit(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = [...a].map(String).sort().join('\0');
  const sb = [...b].map(String).sort().join('\0');
  return sa === sb;
}

/** Canonical child-game LLM blob: `suggested_activities` only; strip `activities` if echoed. */
export function normalizeChildGameRecommendations(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const suggested = Array.isArray(raw.suggested_activities) ? [...raw.suggested_activities] : [];
  const { activities: _a, suggested_activities: _s, ...rest } = raw;
  return { ...rest, suggested_activities: suggested };
}

/** Max picks for an area — keep in sync with persist throttling in RecommendationsPhase. */
export function getChildActivityMaxSelections(areaId) {
  const game = areaGames[areaId] || areaGames.life_ambition;
  return typeof game.maxSelections === 'number' ? game.maxSelections : 3;
}

export default function ChildActivityGame({
  childName,
  areaId = 'life_ambition',
  selectedIds = [],
  onSelectedIdsChange,
  onComplete,
}) {
  const game = areaGames[areaId] || areaGames.life_ambition;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedImages, setFailedImages] = useState(new Set());

  const ids = Array.isArray(selectedIds) ? selectedIds : [];

  const toggleSelection = (id) => {
    const notify = onSelectedIdsChange || (() => {});
    if (ids.includes(id)) {
      notify(ids.filter((s) => s !== id));
    } else if (ids.length < game.maxSelections) {
      notify([...ids, id]);
    } else {
      toast.error(`You can select maximum ${game.maxSelections} options`);
    }
  };

  const handleSubmit = async () => {
    if (ids.length === 0) {
      toast.error('Please select at least 1 option');
      return;
    }

    setIsSubmitting(true);

    try {
      // Check DB first — skip LLM if results already saved for this area
      const completedData = await api.completedGrowthAreas.list();
      const existing = completedData?.areas?.find((a) => a.area_id === areaId);
      if (existing?.child_activity?.results) {
        const recommendations = normalizeChildGameRecommendations(existing.child_activity.results);
        const done = onComplete({ selections: existing.child_activity.selections ?? ids, recommendations });
        if (done != null && typeof done.then === 'function') await done;
        setIsSubmitting(false);
        return;
      }
    } catch {
      /* fall through to LLM */
    }

    const selectedLabels = ids.map((id) => game.options.find((o) => o.id === id)?.label).join(', ');

    try {
      const raw = await api.integrations.Core.InvokeLLM({
        prompt: `A child named ${childName} has made the following selections.\n\n${game.promptContext(selectedLabels)}`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            suggested_activities: { type: "array", items: { type: "string" } },
            strengths: { type: "array", items: { type: "string" } },
          },
        },
      });

      const recommendations = normalizeChildGameRecommendations(raw);
      const done = onComplete({ selections: ids, recommendations });
      if (done != null && typeof done.then === 'function') await done;
    } catch {
      toast.error('Could not generate recommendations. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">{game.question}</h2>
        <p className="text-slate-500">{game.subtitle}</p>
        <p className="text-sm text-emerald-600 mt-2">Selected: {ids.length}/{game.maxSelections}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {game.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => toggleSelection(option.id)}
            className={`relative rounded-2xl overflow-hidden border-4 text-left transition-[border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] ${
              ids.includes(option.id)
                ? 'border-emerald-500 shadow-lg'
                : 'border-slate-200 hover:border-emerald-300'
            }`}
          >
            {option.image && !failedImages.has(option.id) ? (
              <div className="aspect-[4/3] relative overflow-hidden">
                <img
                  src={option.image}
                  alt={option.label}
                  className="w-full h-full object-cover"
                  onError={() => setFailedImages((prev) => new Set([...prev, option.id]))}
                />
              </div>
            ) : (
              <div className={`aspect-[4/3] bg-gradient-to-br ${TILE_GRADIENTS[index % TILE_GRADIENTS.length]} flex items-center justify-center`}>
                <span className="text-5xl select-none">{option.emoji}</span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-between p-3">
              <span className="text-white font-semibold text-sm">{option.label}</span>
              {ids.includes(option.id) ? (
                <CheckCircle className="w-6 h-6 text-white fill-emerald-500" />
              ) : (
                <Circle className="w-6 h-6 text-white/80" />
              )}
            </div>
          </button>
        ))}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={ids.length === 0 || isSubmitting}
        className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
      >
        {isSubmitting ? 'Generating Recommendations...' : 'Submit My Choices'}
      </Button>
    </div>
  );
}