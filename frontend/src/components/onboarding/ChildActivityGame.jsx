import { useState, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/button';
import { CheckCircle, Circle } from 'lucide-react';
import { api } from '@/api/client';
import { toast } from 'sonner';

// Module-level cache of asset paths that have previously failed to load.
// Lives outside the component so it survives remounts, StrictMode double-invocations,
// and HMR restarts — preventing any failed image from ever being retried in the session.
const _failedAssetPaths = new Set();

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
    question: 'What do you want to become in life?',
    subtitle: 'Choose up to 3 options that excite you!',
    maxSelections: 3,
    options: [
      {
        id: 'astronaut',
        label: 'Astronaut',
        emoji: '🚀',
        image: 'child_activity_game/life_ambition/astronaut.jpg',
      },
      {
        id: 'sports',
        label: 'Sports Person',
        emoji: '⚽',
        image: 'child_activity_game/life_ambition/sports_person.jpg',
      },
      {
        id: 'parent',
        label: 'Like My Parents',
        emoji: '👨‍👩‍👧',
        image: 'child_activity_game/life_ambition/like_my_parents.jpg',
      },
      {
        id: 'superhero',
        label: 'Super Hero',
        emoji: '🦸',
        image: 'child_activity_game/life_ambition/super_hero.jpg',
      },
      {
        id: 'dancer',
        label: 'Dancer',
        emoji: '💃',
        image: 'child_activity_game/life_ambition/dancer.jpg',
      },
      {
        id: 'scientist',
        label: 'Scientist',
        emoji: '🔬',
        image: 'child_activity_game/life_ambition/scientist.jpg',
      },
    ],
    promptContext: (labels) =>
      `A child has selected these career aspirations: ${labels}. Generate personalized recommendations for the parent to help nurture these interests: 1. A brief summary of what these choices reveal about the child's interests, 2. 3-4 specific activities or experiences to support these aspirations, 3. 2-3 strengths to encourage based on these choices.`,
  },
  self_care: {
    question: 'Which activities make you feel calm and happy?',
    subtitle: 'Pick up to 3 things you enjoy!',
    maxSelections: 3,
    options: [
      {
        id: 'reading',
        label: 'Reading',
        emoji: '📚',
        image: 'child_activity_game/self_care/reading.jpg',
      },
      {
        id: 'music',
        label: 'Listening to Music',
        emoji: '🎵',
        image: 'child_activity_game/self_care/listening_to_music.jpg',
      },
      {
        id: 'nature',
        label: 'Being in Nature',
        emoji: '🌿',
        image: 'child_activity_game/self_care/being_in_nature.jpg',
      },
      {
        id: 'drawing',
        label: 'Drawing / Painting',
        emoji: '🎨',
        image: 'child_activity_game/self_care/drawing_painting.jpg',
      },
      {
        id: 'sleep',
        label: 'Resting / Sleeping',
        emoji: '😴',
        image: 'child_activity_game/self_care/resting_sleeping.jpg',
      },
      {
        id: 'exercise',
        label: 'Exercise',
        emoji: '🏃',
        image: 'child_activity_game/self_care/exercise.jpg',
      },
    ],
    promptContext: (labels) =>
      `A child has chosen these self-care activities as things that make them feel calm and happy: ${labels}. Generate personalized self-care recommendations for the parent: 1. A brief summary of what these choices reveal about the child's emotional needs, 2. 3-4 specific ways to support these self-care habits at home, 3. 2-3 emotional strengths to encourage.`,
  },
  critical_thinking: {
    question: 'Which challenges do you enjoy most?',
    subtitle: 'Choose up to 3 that sound fun!',
    maxSelections: 3,
    options: [
      {
        id: 'puzzles',
        label: 'Solving Puzzles',
        emoji: '🧩',
        image: 'child_activity_game/critical_thinking/solving_puzzles.jpg',
      },
      {
        id: 'experiments',
        label: 'Science Experiments',
        emoji: '🧪',
        image: 'child_activity_game/critical_thinking/science_experiments.jpg',
      },
      {
        id: 'debates',
        label: 'Debates & Arguments',
        emoji: '💬',
        image: 'child_activity_game/critical_thinking/debates_arguments.jpg',
      },
      {
        id: 'strategy',
        label: 'Strategy Games',
        emoji: '♟️',
        image: 'child_activity_game/critical_thinking/strategy_games.jpg',
      },
      {
        id: 'mysteries',
        label: 'Solving Mysteries',
        emoji: '🔍',
        image: 'child_activity_game/critical_thinking/solving_mysteries.jpg',
      },
      {
        id: 'inventions',
        label: 'Inventing Things',
        emoji: '💡',
        image: 'child_activity_game/critical_thinking/inventing_things.jpg',
      },
    ],
    promptContext: (labels) =>
      `A child has chosen these thinking challenges as their favourites: ${labels}. Generate personalized recommendations for the parent to develop their critical thinking: 1. A brief summary of what these choices reveal about the child's thinking style, 2. 3-4 specific activities to sharpen these skills, 3. 2-3 cognitive strengths to encourage.`,
  },
  creativity: {
    question: 'Which creative activities do you love?',
    subtitle: 'Pick up to 3 that spark your imagination!',
    maxSelections: 3,
    options: [
      {
        id: 'drawing',
        label: 'Drawing & Art',
        emoji: '🎨',
        image: 'child_activity_game/creativity/drawing_art.jpg',
      },
      {
        id: 'storytelling',
        label: 'Storytelling',
        emoji: '📖',
        image: 'child_activity_game/creativity/storytelling.jpg',
      },
      {
        id: 'music',
        label: 'Making Music',
        emoji: '🎸',
        image: 'child_activity_game/creativity/making_music.jpg',
      },
      {
        id: 'building',
        label: 'Building & Making',
        emoji: '🏗️',
        image: 'child_activity_game/creativity/building_making.jpg',
      },
      {
        id: 'acting',
        label: 'Acting & Drama',
        emoji: '🎭',
        image: 'child_activity_game/creativity/acting_drama.jpg',
      },
      {
        id: 'cooking',
        label: 'Cooking & Baking',
        emoji: '🍳',
        image: 'child_activity_game/creativity/cooking_baking.jpg',
      },
    ],
    promptContext: (labels) =>
      `A child has chosen these creative activities as their favourites: ${labels}. Generate personalized recommendations for the parent to nurture their creativity: 1. A brief summary of what these choices reveal about the child's creative personality, 2. 3-4 specific ways to encourage and develop these creative skills, 3. 2-3 creative strengths to celebrate.`,
  },
  physical_wellness: {
    question: 'Which physical activities do you enjoy?',
    subtitle: 'Choose up to 3 that get you moving!',
    maxSelections: 3,
    options: [
      {
        id: 'football',
        label: 'Football / Soccer',
        emoji: '⚽',
        image: 'child_activity_game/physical_wellness/football_soccer.jpg',
      },
      {
        id: 'swimming',
        label: 'Swimming',
        emoji: '🏊',
        image: 'child_activity_game/physical_wellness/swimming.jpg',
      },
      {
        id: 'cycling',
        label: 'Cycling',
        emoji: '🚴',
        image: 'child_activity_game/physical_wellness/cycling.jpg',
      },
      {
        id: 'dancing',
        label: 'Dancing',
        emoji: '💃',
        image: 'child_activity_game/physical_wellness/dancing.jpg',
      },
      {
        id: 'yoga',
        label: 'Yoga / Stretching',
        emoji: '🧘',
        image: 'child_activity_game/physical_wellness/yoga_stretching.jpg',
      },
      {
        id: 'running',
        label: 'Running',
        emoji: '🏃',
        image: 'child_activity_game/physical_wellness/running.jpg',
      },
    ],
    promptContext: (labels) =>
      `A child has chosen these physical activities as their favourites: ${labels}. Generate personalized physical wellness recommendations for the parent: 1. A brief summary of what these choices reveal about the child's physical personality, 2. 3-4 specific ways to support and grow these physical habits, 3. 2-3 physical strengths to encourage.`,
  },
  social_skills: {
    question: 'Which situations feel most natural to you?',
    subtitle: 'Choose up to 3 that sound like you!',
    maxSelections: 3,
    options: [
      {
        id: 'helping',
        label: 'Helping Others',
        emoji: '🤝',
        image: 'child_activity_game/social_skills/helping_others.jpg',
      },
      {
        id: 'leading',
        label: 'Leading a Group',
        emoji: '👑',
        image: 'child_activity_game/social_skills/leading_a_group.jpg',
      },
      {
        id: 'listening',
        label: 'Listening to Friends',
        emoji: '👂',
        image: 'child_activity_game/social_skills/listening_to_friends.jpg',
      },
      {
        id: 'teamwork',
        label: 'Working in a Team',
        emoji: '🙌',
        image: 'child_activity_game/social_skills/working_in_a_team.jpg',
      },
      {
        id: 'making_friends',
        label: 'Making New Friends',
        emoji: '😊',
        image: 'child_activity_game/social_skills/making_new_friends.jpg',
      },
      {
        id: 'alone',
        label: 'Enjoying My Own Time',
        emoji: '🧸',
        image: 'child_activity_game/social_skills/enjoying_my_own_time.jpg',
      },
    ],
    promptContext: (labels) =>
      `A child has identified these social situations as most natural to them: ${labels}. Generate personalized social skills recommendations for the parent: 1. A brief summary of what these choices reveal about the child's social personality, 2. 3-4 specific activities to strengthen their social skills, 3. 2-3 social strengths to celebrate.`,
  },
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

export default function ChildActivityGame({
  childName,
  areaId = 'life_ambition',
  activeChildId,
  selectedIds = [],
  onSelectedIdsChange,
  onComplete,
}) {
  const game = areaGames[areaId] || areaGames.life_ambition;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedImages, setFailedImages] = useState(
    () => new Set(game.options.filter((o) => _failedAssetPaths.has(o.image)).map((o) => o.id)),
  );

  // When areaId changes (component stays mounted), re-seed failedImages from the cache
  // so images that failed in a previous session of the same area are not retried.
  useEffect(() => {
    setFailedImages(
      new Set(game.options.filter((o) => _failedAssetPaths.has(o.image)).map((o) => o.id)),
    );
    // game is derived from areaId; only re-run when the area actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId]);

  const ids = Array.isArray(selectedIds) ? selectedIds : [];

  const toggleSelection = useCallback(
    (id) => {
      const notify = onSelectedIdsChange || (() => {});
      if (ids.includes(id)) {
        notify(ids.filter((s) => s !== id));
      } else if (ids.length < game.maxSelections) {
        notify([...ids, id]);
      } else {
        toast.error(`You can select maximum ${game.maxSelections} options`);
      }
    },
    [ids, game.maxSelections, onSelectedIdsChange],
  );

  const handleSubmit = async () => {
    if (ids.length === 0) {
      toast.error('Please select at least 1 option');
      return;
    }

    setIsSubmitting(true);

    try {
      // Check DB first — skip LLM if results already saved for this area
      const completedData = await api.completedGrowthAreas.list(activeChildId);
      const existing = completedData?.areas?.find((a) => a.area_id === areaId);
      if (existing?.child_activity?.results) {
        const recommendations = normalizeChildGameRecommendations(existing.child_activity.results);
        const done = onComplete({
          selections: existing.child_activity.selections ?? ids,
          recommendations,
        });
        if (done != null && typeof done.then === 'function') await done;
        setIsSubmitting(false);
        return;
      }
    } catch (err) {
      console.warn('[ChildActivityGame] Cached result fetch failed, falling through to LLM:', err);
    }

    const selectedLabels = ids.map((id) => game.options.find((o) => o.id === id)?.label).join(', ');

    try {
      const raw = await api.integrations.Core.InvokeLLM({
        prompt: `A child named ${childName} has made the following selections.\n\n${game.promptContext(selectedLabels)}`,
        response_json_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            suggested_activities: { type: 'array', items: { type: 'string' } },
            strengths: { type: 'array', items: { type: 'string' } },
          },
        },
      });

      const recommendations = normalizeChildGameRecommendations(raw);
      const done = onComplete({ selections: ids, recommendations });
      if (done != null && typeof done.then === 'function') await done;
    } catch (err) {
      console.error('[ChildActivityGame] Recommendation generation failed:', err);
      toast.error('Could not generate recommendations. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="mb-2 text-2xl font-bold text-white">{game.question}</h2>
        <p className="text-slate-500">{game.subtitle}</p>
        <p className="mt-2 text-sm text-emerald-600">
          Selected: {ids.length}/{game.maxSelections}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {game.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => toggleSelection(option.id)}
            className={`relative overflow-hidden rounded-2xl border-4 text-left transition-[border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] ${
              ids.includes(option.id)
                ? 'border-emerald-500 shadow-lg'
                : 'border-c-edge hover:border-emerald-500/50'
            }`}
          >
            {option.image && !failedImages.has(option.id) ? (
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={`/assets/${option.image}`}
                  alt={option.label}
                  className="h-full w-full object-cover"
                  onError={() => {
                    _failedAssetPaths.add(option.image);
                    setFailedImages((prev) => new Set([...prev, option.id]));
                  }}
                />
              </div>
            ) : (
              <div
                className={`aspect-[4/3] bg-gradient-to-br ${TILE_GRADIENTS[index % TILE_GRADIENTS.length]} flex items-center justify-center`}
              >
                <span className="select-none text-5xl">{option.emoji}</span>
              </div>
            )}
            <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-3">
              <span className="text-sm font-semibold text-white">{option.label}</span>
              {ids.includes(option.id) ? (
                <CheckCircle className="h-6 w-6 fill-emerald-500 text-white" />
              ) : (
                <Circle className="h-6 w-6 text-white/80" />
              )}
            </div>
          </button>
        ))}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={ids.length === 0 || isSubmitting}
        className="h-12 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
      >
        {isSubmitting ? 'Generating Recommendations...' : 'Submit My Choices'}
      </Button>
    </div>
  );
}

ChildActivityGame.propTypes = {
  childName: PropTypes.string,
  areaId: PropTypes.string,
  selectedIds: PropTypes.arrayOf(PropTypes.string),
  onSelectedIdsChange: PropTypes.func,
  onComplete: PropTypes.func.isRequired,
};
