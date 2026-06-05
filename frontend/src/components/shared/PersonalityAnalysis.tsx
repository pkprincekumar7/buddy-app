import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { personalizedDescriptionOneLiner } from '@/lib/personalizedDescriptionOneLiner';
import { generateAvatarDataUri } from '@/lib/avatarUtils';
import { pickPreferredVoice } from '@/lib/tts';

interface PersonalityCategory {
  name: string;
  color: string;
  description: string;
}

// New Personality Framework
// eslint-disable-next-line react-refresh/only-export-components
export const personalityCategories: Record<string, PersonalityCategory> = {
  motivators: {
    name: 'Motivators',
    color: 'from-red-500 to-orange-600',
    description: 'Driven by goals, ambition, and achievement',
  },
  socializers: {
    name: 'Socializers',
    color: 'from-yellow-400 to-orange-500',
    description: 'Energized by people and connection',
  },
  creatives: {
    name: 'Creatives',
    color: 'from-purple-400 to-pink-500',
    description: 'Inspired by imagination and expression',
  },
  adventurers: {
    name: 'Adventurers',
    color: 'from-orange-400 to-red-500',
    description: 'Seeking variety and new experiences',
  },
};

interface FamousPerson {
  name: string;
  image?: string;
}

interface PersonalityTypeEntry {
  name: string;
  category: string;
  traits: string[];
  description: string;
  famous_people: FamousPerson[];
  color: string;
  strengths: string[];
  growth_areas: string[];
}

// eslint-disable-next-line react-refresh/only-export-components
export const personalityTypes: Record<string, PersonalityTypeEntry> = {
  Ambitious: {
    name: 'Ambitious',
    category: 'motivators',
    traits: ['Goal-oriented', 'Driven', 'Competitive', 'Persistent', 'Forward-thinking'],
    description:
      '{childName} sets high standards, aims big, and is motivated by achieving success. They connect effort today with future goals and are energized by challenges.',
    famous_people: [
      {
        name: 'Serena Williams',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Serena_Williams_2013.jpg/220px-Serena_Williams_2013.jpg',
      },
      {
        name: 'Elon Musk',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Elon_Musk_Royal_Society_%28crop2%29.jpg/220px-Elon_Musk_Royal_Society_%28crop2%29.jpg',
      },
    ],
    color: 'from-red-500 to-pink-600',
    strengths: ['Persistence', 'High standards', 'Focus on goals', 'Motivation'],
    growth_areas: ['Patience', 'Managing stress', 'Flexibility in approach'],
  },
  Determined: {
    name: 'Determined',
    category: 'motivators',
    traits: ['Focused', 'Hardworking', 'Resilient', 'Patient', 'Goal-oriented'],
    description:
      '{childName} shows strong persistence, continues even in the face of difficulty, and is motivated to finish what they start.',
    famous_people: [
      {
        name: 'Thomas Edison',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Thomas_Edison2.jpg/220px-Thomas_Edison2.jpg',
      },
      {
        name: 'Malala Yousafzai',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Malala_Yousafzai_at_Girl_Summit_2014-_cropped.jpg/220px-Malala_Yousafzai_at_Girl_Summit_2014-_cropped.jpg',
      },
    ],
    color: 'from-orange-500 to-red-600',
    strengths: ['Persistence', 'Goal completion', 'Hard work', 'Motivation under pressure'],
    growth_areas: ['Flexibility', 'Handling setbacks calmly', 'Seeking help when needed'],
  },
  Outgoing: {
    name: 'Outgoing',
    category: 'socializers',
    traits: ['Friendly', 'Sociable', 'Confident', 'Energetic', 'Engaging'],
    description:
      '{childName} thrives in social settings, enjoys meeting new people, and energizes others through their presence and enthusiasm.',
    famous_people: [
      {
        name: 'Oprah Winfrey',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Oprah_in_2014.jpg/220px-Oprah_in_2014.jpg',
      },
      {
        name: 'Will Smith',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Will_Smith_2011.jpg/220px-Will_Smith_2011.jpg',
      },
    ],
    color: 'from-yellow-400 to-orange-500',
    strengths: ['Networking', 'Communication', 'Confidence', 'Positive energy'],
    growth_areas: ['Listening skills', 'Sensitivity to introverts', 'Managing overstimulation'],
  },
  Creative: {
    name: 'Creative',
    category: 'creatives',
    traits: ['Imaginative', 'Inventive', 'Curious', 'Expressive', 'Resourceful'],
    description:
      '{childName} enjoys creating, imagining new possibilities, and finding unique solutions. They are inspired by self-expression and novel ideas.',
    famous_people: [
      {
        name: 'Leonardo da Vinci',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Leonardo_self.jpg/220px-Leonardo_self.jpg',
      },
      {
        name: 'Frida Kahlo',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Frida_Kahlo%2C_by_Guillermo_Kahlo.jpg/220px-Frida_Kahlo%2C_by_Guillermo_Kahlo.jpg',
      },
    ],
    color: 'from-purple-400 to-pink-500',
    strengths: ['Imagination', 'Problem-solving', 'Adaptability', 'Artistic skills'],
    growth_areas: ['Practical implementation', 'Time management', 'Accepting criticism'],
  },
  Enthusiastic: {
    name: 'Enthusiastic',
    category: 'motivators',
    traits: ['Excitable', 'Optimistic', 'Eager', 'Passionate', 'Energetic'],
    description:
      '{childName} approaches new experiences with eagerness, expresses joy openly, and brings energy to their surroundings.',
    famous_people: [
      {
        name: 'Robin Williams',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Robin_Williams_2011a_%282%29.jpg/220px-Robin_Williams_2011a_%282%29.jpg',
      },
      {
        name: 'Ellen DeGeneres',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Ellen_DeGeneres_2011.jpg/220px-Ellen_DeGeneres_2011.jpg',
      },
    ],
    color: 'from-emerald-400 to-yellow-500',
    strengths: ['Positive energy', 'Motivation', 'Inspiration to others', 'Optimism'],
    growth_areas: ['Focusing energy', 'Patience', 'Managing disappointment'],
  },
  Restless: {
    name: 'Restless',
    category: 'adventurers',
    traits: ['Curious', 'Impatient', 'Varied interests', 'Energetic', 'Quick-moving'],
    description:
      '{childName} prefers variety and fast-paced activities, seeks new experiences, and gets bored when things are slow or repetitive.',
    famous_people: [
      {
        name: 'Richard Branson',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Richard_Branson_2011.jpg/220px-Richard_Branson_2011.jpg',
      },
      {
        name: 'Bear Grylls',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Bear_Grylls_at_the_Webby_Awards.jpg/220px-Bear_Grylls_at_the_Webby_Awards.jpg',
      },
    ],
    color: 'from-orange-400 to-red-500',
    strengths: ['Adaptability', 'Energy', 'Variety-seeking', 'Quick learning'],
    growth_areas: ['Patience', 'Long-term focus', 'Consistency'],
  },
  'Highly Energetic': {
    name: 'Highly Energetic',
    category: 'motivators',
    traits: ['Active', 'Vibrant', 'Enthusiastic', 'Persistent', 'Alert'],
    description:
      '{childName} has a high energy level, enjoys being active, and can engage in multiple activities with stamina and vitality.',
    famous_people: [
      {
        name: 'Serena Williams',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Serena_Williams_2013.jpg/220px-Serena_Williams_2013.jpg',
      },
      {
        name: 'Dwayne Johnson',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Dwayne_Johnson_2014.jpg/220px-Dwayne_Johnson_2014.jpg',
      },
    ],
    color: 'from-red-500 to-yellow-500',
    strengths: ['Stamina', 'Multitasking', 'Enthusiasm', 'Persistence'],
    growth_areas: ['Rest and recovery', 'Focus', 'Patience with slower activities'],
  },
  Thinker: {
    name: 'Thinker',
    category: 'creatives',
    traits: ['Curious', 'Analytical', 'Observant', 'Thoughtful', 'Problem-solver'],
    description:
      '{childName} enjoys thinking deeply, solving problems, asking questions, and reflecting on experiences.',
    famous_people: [
      {
        name: 'Albert Einstein',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/220px-Albert_Einstein_Head.jpg',
      },
      {
        name: 'Marie Curie',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Marie_Curie_c1920.jpg/220px-Marie_Curie_c1920.jpg',
      },
    ],
    color: 'from-blue-400 to-indigo-500',
    strengths: ['Analytical thinking', 'Problem-solving', 'Curiosity', 'Reflection'],
    growth_areas: ['Action-taking', 'Practical application', 'Social interaction'],
  },
  Playful: {
    name: 'Playful',
    category: 'socializers',
    traits: ['Joyful', 'Silly', 'Energetic', 'Curious', 'Spontaneous'],
    description:
      '{childName} brings fun and joy to situations, enjoys games and surprises, and approaches life with a light-hearted spirit.',
    famous_people: [
      {
        name: 'Jim Carrey',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Jim_Carrey_2011.jpg/220px-Jim_Carrey_2011.jpg',
      },
      {
        name: 'Robin Williams',
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Robin_Williams_2011a_%282%29.jpg/220px-Robin_Williams_2011a_%282%29.jpg',
      },
    ],
    color: 'from-pink-400 to-purple-500',
    strengths: ['Humor', 'Joy', 'Creativity', 'Social engagement'],
    growth_areas: ['Focus', 'Handling serious tasks', 'Patience'],
  },
};

interface CalculateMbtiData {
  energy_level?: string;
  thinking_pattern?: string;
  communication_style?: string;
  social_behaviour?: string;
  emotional_behaviour?: string;
  name?: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function calculateMBTI(data: CalculateMbtiData) {
  const scores: Record<string, number> = {
    Ambitious: 0,
    Determined: 0,
    Outgoing: 0,
    Creative: 0,
    Enthusiastic: 0,
    Restless: 0,
    'Highly Energetic': 0,
    Thinker: 0,
    Playful: 0,
  };

  // Energy level
  if (data.energy_level === 'High energy - always active') {
    scores['Highly Energetic'] = (scores['Highly Energetic'] ?? 0) + 3;
    scores['Restless'] = (scores['Restless'] ?? 0) + 2;
    scores['Enthusiastic'] = (scores['Enthusiastic'] ?? 0) + 2;
  } else if (data.energy_level === 'Moderate - balanced') {
    scores['Determined'] = (scores['Determined'] ?? 0) + 2;
    scores['Ambitious'] = (scores['Ambitious'] ?? 0) + 1;
  } else if (data.energy_level === 'Calm and composed') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 3;
    scores['Creative'] = (scores['Creative'] ?? 0) + 1;
  } else {
    scores['Restless'] = (scores['Restless'] ?? 0) + 2;
    scores['Highly Energetic'] = (scores['Highly Energetic'] ?? 0) + 1;
  }

  // Thinking pattern
  if (data.thinking_pattern === 'Visual') {
    scores['Creative'] = (scores['Creative'] ?? 0) + 2;
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 1;
  } else if (data.thinking_pattern === 'Analytical') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 3;
    scores['Ambitious'] = (scores['Ambitious'] ?? 0) + 2;
  } else if (data.thinking_pattern === 'Imaginative') {
    scores['Creative'] = (scores['Creative'] ?? 0) + 3;
    scores['Playful'] = (scores['Playful'] ?? 0) + 1;
  } else {
    scores['Creative'] = (scores['Creative'] ?? 0) + 1;
  }

  // Communication style
  if (data.communication_style === 'Talkative') {
    scores['Outgoing'] = (scores['Outgoing'] ?? 0) + 3;
    scores['Enthusiastic'] = (scores['Enthusiastic'] ?? 0) + 2;
  } else if (data.communication_style === 'Deep Listener') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 2;
    scores['Determined'] = (scores['Determined'] ?? 0) + 1;
  } else if (data.communication_style === 'Communicates through gestures') {
    scores['Creative'] = (scores['Creative'] ?? 0) + 2;
  } else if (data.communication_style === 'Silent') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 3;
  } else if (data.communication_style === 'Observant') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 2;
    scores['Creative'] = (scores['Creative'] ?? 0) + 1;
  }

  // Social behaviour
  if (data.social_behaviour === 'Confident') {
    scores['Outgoing'] = (scores['Outgoing'] ?? 0) + 3;
    scores['Ambitious'] = (scores['Ambitious'] ?? 0) + 2;
  } else if (data.social_behaviour === 'Friendly') {
    scores['Outgoing'] = (scores['Outgoing'] ?? 0) + 2;
    scores['Enthusiastic'] = (scores['Enthusiastic'] ?? 0) + 2;
    scores['Playful'] = (scores['Playful'] ?? 0) + 1;
  } else if (data.social_behaviour === 'Reserved') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 2;
    scores['Creative'] = (scores['Creative'] ?? 0) + 1;
  } else if (data.social_behaviour === 'Expressive') {
    scores['Enthusiastic'] = (scores['Enthusiastic'] ?? 0) + 2;
    scores['Playful'] = (scores['Playful'] ?? 0) + 2;
    scores['Creative'] = (scores['Creative'] ?? 0) + 1;
  } else if (data.social_behaviour === 'Withdrawn') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 3;
    scores['Creative'] = (scores['Creative'] ?? 0) + 1;
  }

  // Emotional behaviour
  if (data.emotional_behaviour === 'Calm') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 2;
    scores['Determined'] = (scores['Determined'] ?? 0) + 2;
  } else if (data.emotional_behaviour === 'Sensitive') {
    scores['Creative'] = (scores['Creative'] ?? 0) + 2;
    scores['Enthusiastic'] = (scores['Enthusiastic'] ?? 0) + 1;
  } else if (data.emotional_behaviour === 'Reserved') {
    scores['Thinker'] = (scores['Thinker'] ?? 0) + 2;
    scores['Determined'] = (scores['Determined'] ?? 0) + 1;
  } else if (data.emotional_behaviour === 'Impulsive') {
    scores['Restless'] = (scores['Restless'] ?? 0) + 3;
    scores['Playful'] = (scores['Playful'] ?? 0) + 2;
    scores['Highly Energetic'] = (scores['Highly Energetic'] ?? 0) + 1;
  } else if (data.emotional_behaviour === 'Moody') {
    scores['Creative'] = (scores['Creative'] ?? 0) + 2;
    scores['Restless'] = (scores['Restless'] ?? 0) + 1;
  }

  // Find the highest scoring personality type
  let maxScore = 0;
  let dominantType = 'Creative';

  Object.entries(scores).forEach(([type, score]) => {
    if (score > maxScore) {
      maxScore = score;
      dominantType = type;
    }
  });

  const profile = personalityTypes[dominantType] ?? personalityTypes['Creative']!;

  return {
    type: dominantType,
    scores,
    profile: {
      ...profile,
      description: profile.description.replace('{childName}', data.name ?? 'Your child'),
    },
  };
}

export const PERSONALITY_TYPE_KEYS = Object.keys(personalityTypes);
const PERSONALITY_CATEGORY_KEYS = ['motivators', 'socializers', 'creatives', 'adventurers'];

interface RoleModel {
  name?: unknown;
  [key: string]: unknown;
}

function roleModelAvatars(roleModels: unknown, fallbackName: string | undefined): FamousPerson[] {
  const list: RoleModel[] = Array.isArray(roleModels) ? (roleModels as RoleModel[]) : [];
  const two = [...list.slice(0, 2)];
  while (two.length < 2) {
    two.push({ name: two.length === 0 ? (fallbackName ?? 'Role model A') : 'Role model B' });
  }
  return two.map((r) => {
    const nm = typeof r?.name === 'string' && r.name.trim() ? r.name.trim() : 'Guide';
    return {
      name: nm,
      image: generateAvatarDataUri(nm),
    };
  });
}

interface AiPersonalityInput {
  dominant_style?: unknown;
  personality_category?: unknown;
  personalized_traits?: unknown;
  personalized_description?: unknown;
  strength_summary_bullets?: unknown;
  personalized_growth_areas?: unknown;
  role_models?: unknown;
  secondary_styles?: unknown;
}

/**
 * Builds the same `{ type, scores, profile }` shape rule-based onboarding uses so the Personality UI renders unchanged.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function adaptAiPersonalityToViewModel(
  ai: AiPersonalityInput,
  childName: string | undefined,
) {
  const safeName = childName?.trim?.() ? childName.trim() : 'your child';

  const dominant: string =
    typeof ai?.dominant_style === 'string' && PERSONALITY_TYPE_KEYS.includes(ai.dominant_style)
      ? ai.dominant_style
      : 'Creative';
  const categoryKey: string =
    typeof ai?.personality_category === 'string' &&
    PERSONALITY_CATEGORY_KEYS.includes(ai.personality_category)
      ? ai.personality_category
      : (personalityTypes[dominant]?.category ?? 'creatives');

  const base = personalityTypes[dominant] ?? personalityTypes['Creative']!;

  const traitsRaw = ai?.personalized_traits;
  const traits =
    Array.isArray(traitsRaw) && traitsRaw.length > 0
      ? (traitsRaw as unknown[]).map((t) => String(t)).filter(Boolean)
      : base.traits;

  const rawDesc =
    typeof ai?.personalized_description === 'string' ? ai.personalized_description.trim() : '';
  const description = rawDesc
    ? personalizedDescriptionOneLiner(
        rawDesc.replace(/\{childName\}/gi, safeName).replace(/\btheir\b/gi, `${safeName}'s`),
      )
    : base.description.replace('{childName}', safeName);

  const strengthsRaw = ai?.strength_summary_bullets;
  const strengths =
    Array.isArray(strengthsRaw) && strengthsRaw.length > 0
      ? (strengthsRaw as unknown[]).map((t) => String(t)).filter(Boolean)
      : base.strengths;

  const gaRaw = ai?.personalized_growth_areas;
  const growth_areas =
    Array.isArray(gaRaw) && gaRaw.length > 0
      ? (gaRaw as unknown[]).map((t) => String(t)).filter(Boolean)
      : base.growth_areas;

  const famous_people = roleModelAvatars(ai?.role_models, safeName);

  const scoresBase: Record<string, number> = PERSONALITY_TYPE_KEYS.reduce(
    (acc, key) => {
      acc[key] = 14;
      return acc;
    },
    {} as Record<string, number>,
  );
  scoresBase[dominant] = 100;

  const secondaries = Array.isArray(ai.secondary_styles) ? (ai.secondary_styles as unknown[]) : [];
  for (let i = 0; i < secondaries.length && i < 2; i++) {
    const sec = secondaries[i] as Record<string, unknown>;
    const sty = typeof sec?.personality_style === 'string' ? sec.personality_style : '';
    if (!PERSONALITY_TYPE_KEYS.includes(sty) || sty === dominant) continue;
    const prom = typeof sec?.prominence === 'number' ? sec.prominence : 72;
    const clamped = Math.max(42, Math.min(96, Number.isFinite(prom) ? prom : 72));
    if (!scoresBase[sty] || (scoresBase[sty] ?? 0) < clamped) scoresBase[sty] = clamped;
  }

  const profile = {
    ...base,
    category: categoryKey,
    name: base.name,
    traits,
    description,
    famous_people,
    strengths,
    growth_areas,
  };

  return {
    type: dominant,
    scores: scoresBase,
    profile,
  };
}

// Animation timing constants — centralised so adjusting the cascade is a one-line change.
const ANIM_TRAIT_BASE = 1.0;
const ANIM_TRAIT_STEP = 0.2;
const ANIM_BAR_BASE = 1.9;
const ANIM_BAR_STEP = 0.25;
const ANIM_BAR_W_BASE = 2.0;
const ANIM_BAR_W_STEP = 0.3;
const ANIM_FAMOUS_BASE = 2.7;
const ANIM_FAMOUS_STEP = 0.3;
const ANIM_STRENGTH_BASE = 3.5;
const ANIM_STRENGTH_STEP = 0.15;

export interface MbtiResult {
  type: string;
  scores: Record<string, number>;
  profile: {
    name?: string;
    category?: string;
    traits?: string[];
    description?: string;
    famous_people?: FamousPerson[];
    strengths?: string[];
    growth_areas?: string[];
    color?: string;
  };
}

interface PersonalityAnalysisProps {
  mbtiResult: MbtiResult;
  childName?: string;
  /** Defer TTS until splash/loading is fully gone. Defaults to true. */
  ready?: boolean;
}

export default function PersonalityAnalysis({
  mbtiResult,
  childName,
  ready = true,
}: PersonalityAnalysisProps) {
  const { scores, profile } = mbtiResult;

  // Fire TTS exactly once — only after the splash/loading overlay is gone (ready=true).
  // Using a ref to prevent re-firing if the parent re-renders with ready=true again.
  const hasSpokeRef = useRef(false);
  useEffect(() => {
    if (!ready || hasSpokeRef.current) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    hasSpokeRef.current = true;
    const famousNames = (profile?.famous_people ?? []).map((p) => p.name).join(' and ');
    const text = `${profile?.description ?? ''}${famousNames ? ` Famous people who share similar traits include ${famousNames}.` : ''}`;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 1.15;
    const voice = pickPreferredVoice();
    if (voice) utter.voice = voice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
    return () => {
      window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Get top 3 personality types by score
  const topTypes = Object.entries(scores)
    .filter(([typeName]) => personalityTypes[typeName]) // Only include valid types
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([typeName, score]) => ({ name: typeName, score: score }));

  const sectionAnim = (delay: number) => ({
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 1.0, delay, ease: 'easeOut' },
  });

  return (
    <div className="space-y-6">
      {/* Section 2 — Main Type Card */}
      <motion.div {...sectionAnim(0.8)} className="border-edge rounded-2xl bg-card p-6">
        <div className="mb-4 text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Sparkles className="h-6 w-6 text-teal-400" />
            <h3 className="text-2xl font-bold text-white">{profile.name}</h3>
          </div>
          <p className="text-sm text-slate-500">{childName}'s personality type</p>
        </div>

        <div className="mb-4 flex flex-wrap justify-center gap-2">
          {(profile.traits ?? []).map((trait, i) => (
            <motion.span
              key={trait}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: ANIM_TRAIT_BASE + i * ANIM_TRAIT_STEP }}
              className="bg-ghost-light border-edge-faint rounded-full px-3 py-1 text-xs text-slate-300"
            >
              {trait}
            </motion.span>
          ))}
        </div>

        <p className="text-center text-sm leading-relaxed text-slate-400">{profile.description}</p>
      </motion.div>

      {/* Section 3 — Personality Profile Breakdown */}
      <motion.div {...sectionAnim(1.6)} className="border-edge rounded-2xl bg-card p-6">
        <h4 className="mb-4 text-sm font-semibold text-white">Personality Profile Breakdown</h4>
        <div className="space-y-4">
          {topTypes.map((item, index) => {
            const maxScore = topTypes[0]?.score ?? 0;
            const percentage = maxScore > 0 ? (item.score / maxScore) * 100 : 0;
            const itemProfile = personalityTypes[item.name];
            if (!itemProfile) return null;
            return (
              <motion.div
                key={item.name}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: ANIM_BAR_BASE + index * ANIM_BAR_STEP }}
              >
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-medium text-slate-300">{itemProfile.name}</span>
                  <span className="text-slate-500">{Math.round(percentage)}%</span>
                </div>
                <div className="bg-ghost-light h-2 overflow-hidden rounded-full">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    transition={{
                      duration: 2.4,
                      delay: ANIM_BAR_W_BASE + index * ANIM_BAR_W_STEP,
                      ease: 'easeInOut',
                    }}
                    className={`h-full bg-gradient-to-r ${itemProfile.color} rounded-full`}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Section 4 — Famous People */}
      <motion.div {...sectionAnim(2.4)} className="border-edge rounded-2xl bg-surface-elevated p-6">
        <h4 className="mb-1 text-sm font-semibold text-white">Famous People</h4>
        <p className="mb-5 text-xs text-slate-500">
          {childName} may relate to who share similar personality traits.
        </p>
        <div className="flex flex-wrap justify-center gap-6">
          {(profile.famous_people ?? []).map((person, i) => (
            <motion.div
              key={person.name}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: ANIM_FAMOUS_BASE + i * ANIM_FAMOUS_STEP }}
              className="flex flex-col items-center gap-2"
            >
              <div className="border-c-md h-14 w-14 overflow-hidden rounded-full border-2">
                <img
                  src={person.image}
                  alt={person.name}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = generateAvatarDataUri(person.name, {
                      background: '1a1a1a',
                      color: '#2dd4bf',
                    });
                  }}
                />
              </div>
              <span className="max-w-[80px] text-center text-xs font-medium leading-tight text-slate-400">
                {person.name}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Section 5 — Strengths */}
      <motion.div
        {...sectionAnim(3.2)}
        className="rounded-2xl border border-emerald-500/15 bg-card p-5"
      >
        <h4 className="mb-3 text-sm font-semibold text-emerald-400">💪 Strengths</h4>
        <ul className="space-y-2">
          {(profile.strengths ?? []).map((s, i) => (
            <motion.li
              key={s}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: ANIM_STRENGTH_BASE + i * ANIM_STRENGTH_STEP }}
              className="flex items-center gap-2.5 text-sm text-slate-400"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              {s}
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}
