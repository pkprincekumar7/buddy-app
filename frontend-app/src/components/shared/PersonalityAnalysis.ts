/**
 * Personality framework logic shared by ConversationalOnboarding and
 * PersonalityJourney — copied verbatim from the web's
 * components/shared/PersonalityAnalysis.tsx. The web file's default-export
 * <PersonalityAnalysis> card is not rendered anywhere in the web app, so only
 * the data and pure functions are ported.
 */
import { personalizedDescriptionOneLiner } from '@/lib/personalizedDescriptionOneLiner';

interface PersonalityCategory {
  name: string;
  color: string;
  description: string;
}

// New Personality Framework
export const personalityCategories: Record<string, PersonalityCategory> = {
  motivators: {
    name: 'Motivators',
    color: 'from-error-medium to-warning-orange-medium',
    description: 'Driven by goals, ambition, and achievement',
  },
  socializers: {
    name: 'Socializers',
    color: 'from-warning to-warning-orange',
    description: 'Energized by people and connection',
  },
  creatives: {
    name: 'Creatives',
    color: 'from-personality-light to-accent-pink',
    description: 'Inspired by imagination and expression',
  },
  adventurers: {
    name: 'Adventurers',
    color: 'from-warning-orange to-error-medium',
    description: 'Seeking variety and new experiences',
  },
};

interface FamousPerson {
  name: string;
  image?: string;
  caption?: string;
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

export const personalityTypes: Record<string, PersonalityTypeEntry> = {
  Ambitious: {
    name: 'Ambitious',
    category: 'motivators',
    traits: [
      'Goal-oriented',
      'Driven',
      'Competitive',
      'Persistent',
      'Forward-thinking',
    ],
    description:
      '{childName} sets high standards, aims big, and is motivated by achieving success. They connect effort today with future goals and are energized by challenges.',
    famous_people: [{ name: 'Serena Williams' }, { name: 'Elon Musk' }],
    color: 'from-error-medium to-accent-pink',
    strengths: [
      'Persistence',
      'High standards',
      'Focus on goals',
      'Motivation',
    ],
    growth_areas: ['Patience', 'Managing stress', 'Flexibility in approach'],
  },
  Determined: {
    name: 'Determined',
    category: 'motivators',
    traits: ['Focused', 'Hardworking', 'Resilient', 'Patient', 'Goal-oriented'],
    description:
      '{childName} shows strong persistence, continues even in the face of difficulty, and is motivated to finish what they start.',
    famous_people: [{ name: 'Thomas Edison' }, { name: 'Malala Yousafzai' }],
    color: 'from-warning-orange-medium to-error-strong',
    strengths: [
      'Persistence',
      'Goal completion',
      'Hard work',
      'Motivation under pressure',
    ],
    growth_areas: [
      'Flexibility',
      'Handling setbacks calmly',
      'Seeking help when needed',
    ],
  },
  Outgoing: {
    name: 'Outgoing',
    category: 'socializers',
    traits: ['Friendly', 'Sociable', 'Confident', 'Energetic', 'Engaging'],
    description:
      '{childName} thrives in social settings, enjoys meeting new people, and energizes others through their presence and enthusiasm.',
    famous_people: [{ name: 'Oprah Winfrey' }, { name: 'Will Smith' }],
    color: 'from-warning to-warning-orange',
    strengths: ['Networking', 'Communication', 'Confidence', 'Positive energy'],
    growth_areas: [
      'Listening skills',
      'Sensitivity to introverts',
      'Managing overstimulation',
    ],
  },
  Creative: {
    name: 'Creative',
    category: 'creatives',
    traits: [
      'Imaginative',
      'Inventive',
      'Curious',
      'Expressive',
      'Resourceful',
    ],
    description:
      '{childName} enjoys creating, imagining new possibilities, and finding unique solutions. They are inspired by self-expression and novel ideas.',
    famous_people: [{ name: 'Leonardo da Vinci' }, { name: 'Frida Kahlo' }],
    color: 'from-personality-light to-accent-pink',
    strengths: [
      'Imagination',
      'Problem-solving',
      'Adaptability',
      'Artistic skills',
    ],
    growth_areas: [
      'Practical implementation',
      'Time management',
      'Accepting criticism',
    ],
  },
  Enthusiastic: {
    name: 'Enthusiastic',
    category: 'motivators',
    traits: ['Excitable', 'Optimistic', 'Eager', 'Passionate', 'Energetic'],
    description:
      '{childName} approaches new experiences with eagerness, expresses joy openly, and brings energy to their surroundings.',
    famous_people: [{ name: 'Robin Williams' }, { name: 'Ellen DeGeneres' }],
    color: 'from-success-bright to-warning-medium',
    strengths: [
      'Positive energy',
      'Motivation',
      'Inspiration to others',
      'Optimism',
    ],
    growth_areas: ['Focusing energy', 'Patience', 'Managing disappointment'],
  },
  Restless: {
    name: 'Restless',
    category: 'adventurers',
    traits: [
      'Curious',
      'Impatient',
      'Varied interests',
      'Energetic',
      'Quick-moving',
    ],
    description:
      '{childName} prefers variety and fast-paced activities, seeks new experiences, and gets bored when things are slow or repetitive.',
    famous_people: [{ name: 'Richard Branson' }, { name: 'Bear Grylls' }],
    color: 'from-warning-orange to-error-medium',
    strengths: ['Adaptability', 'Energy', 'Variety-seeking', 'Quick learning'],
    growth_areas: ['Patience', 'Long-term focus', 'Consistency'],
  },
  'Highly Energetic': {
    name: 'Highly Energetic',
    category: 'motivators',
    traits: ['Active', 'Vibrant', 'Enthusiastic', 'Persistent', 'Alert'],
    description:
      '{childName} has a high energy level, enjoys being active, and can engage in multiple activities with stamina and vitality.',
    famous_people: [{ name: 'Serena Williams' }, { name: 'Dwayne Johnson' }],
    color: 'from-error-medium to-warning-medium',
    strengths: ['Stamina', 'Multitasking', 'Enthusiasm', 'Persistence'],
    growth_areas: [
      'Rest and recovery',
      'Focus',
      'Patience with slower activities',
    ],
  },
  Thinker: {
    name: 'Thinker',
    category: 'creatives',
    traits: [
      'Curious',
      'Analytical',
      'Observant',
      'Thoughtful',
      'Problem-solver',
    ],
    description:
      '{childName} enjoys thinking deeply, solving problems, asking questions, and reflecting on experiences.',
    famous_people: [{ name: 'Albert Einstein' }, { name: 'Marie Curie' }],
    color: 'from-info to-personality-alt-strong',
    strengths: [
      'Analytical thinking',
      'Problem-solving',
      'Curiosity',
      'Reflection',
    ],
    growth_areas: [
      'Action-taking',
      'Practical application',
      'Social interaction',
    ],
  },
  Playful: {
    name: 'Playful',
    category: 'socializers',
    traits: ['Joyful', 'Silly', 'Energetic', 'Curious', 'Spontaneous'],
    description:
      '{childName} brings fun and joy to situations, enjoys games and surprises, and approaches life with a light-hearted spirit.',
    famous_people: [{ name: 'Jim Carrey' }, { name: 'Robin Williams' }],
    color: 'from-accent-pink to-personality',
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

  const profile =
    personalityTypes[dominantType] ?? personalityTypes['Creative']!;

  return {
    type: dominantType,
    scores,
    profile: {
      ...profile,
      description: profile.description.replace(
        '{childName}',
        data.name ?? 'Your child',
      ),
    },
  };
}

export const PERSONALITY_TYPE_KEYS = Object.keys(personalityTypes);
const PERSONALITY_CATEGORY_KEYS = [
  'motivators',
  'socializers',
  'creatives',
  'adventurers',
];

interface AiPersonalityInput {
  dominant_style?: unknown;
  personality_category?: unknown;
  personalized_traits?: unknown;
  personalized_description?: unknown;
  strength_summary_bullets?: unknown;
  personalized_growth_areas?: unknown;
  role_models?: unknown;
  secondary_styles?: unknown;
  trait_scores?: unknown;
  child_quote?: unknown;
  parent_note?: unknown;
}

/**
 * Builds the same `{ type, scores, profile }` shape rule-based onboarding uses so the Personality UI renders unchanged.
 */
export function adaptAiPersonalityToViewModel(
  ai: AiPersonalityInput,
  childName: string | undefined,
) {
  const safeName = childName?.trim?.() ? childName.trim() : 'your child';

  const dominant: string =
    typeof ai?.dominant_style === 'string' &&
    PERSONALITY_TYPE_KEYS.includes(ai.dominant_style)
      ? ai.dominant_style
      : 'Creative';
  const categoryKey: string =
    typeof ai?.personality_category === 'string' &&
    PERSONALITY_CATEGORY_KEYS.includes(ai.personality_category)
      ? ai.personality_category
      : personalityTypes[dominant]?.category ?? 'creatives';

  const base = personalityTypes[dominant] ?? personalityTypes['Creative']!;

  const traitsRaw = ai?.personalized_traits;
  const traits =
    Array.isArray(traitsRaw) && traitsRaw.length > 0
      ? (traitsRaw as unknown[]).map(t => String(t)).filter(Boolean)
      : base.traits;

  const rawDesc =
    typeof ai?.personalized_description === 'string'
      ? ai.personalized_description.trim()
      : '';
  const description = rawDesc
    ? personalizedDescriptionOneLiner(
        rawDesc
          .replace(/\{childName\}/gi, safeName)
          .replace(/\btheir\b/gi, `${safeName}'s`),
      )
    : base.description.replace('{childName}', safeName);

  const strengthsRaw = ai?.strength_summary_bullets;
  const strengths =
    Array.isArray(strengthsRaw) && strengthsRaw.length > 0
      ? (strengthsRaw as unknown[]).map(t => String(t)).filter(Boolean)
      : base.strengths;

  const gaRaw = ai?.personalized_growth_areas;
  const growth_areas =
    Array.isArray(gaRaw) && gaRaw.length > 0
      ? (gaRaw as unknown[]).map(t => String(t)).filter(Boolean)
      : base.growth_areas;

  const famous_people = base.famous_people ?? [];

  const scoresBase: Record<string, number> = PERSONALITY_TYPE_KEYS.reduce(
    (acc, key) => {
      acc[key] = 14;
      return acc;
    },
    {} as Record<string, number>,
  );
  scoresBase[dominant] = 100;

  const secondaries = Array.isArray(ai.secondary_styles)
    ? (ai.secondary_styles as unknown[])
    : [];
  for (let i = 0; i < secondaries.length && i < 2; i++) {
    const sec = secondaries[i] as Record<string, unknown>;
    const sty =
      typeof sec?.personality_style === 'string' ? sec.personality_style : '';
    if (!PERSONALITY_TYPE_KEYS.includes(sty) || sty === dominant) continue;
    const prom = typeof sec?.prominence === 'number' ? sec.prominence : 72;
    const clamped = Math.max(
      42,
      Math.min(96, Number.isFinite(prom) ? prom : 72),
    );
    if (!scoresBase[sty] || (scoresBase[sty] ?? 0) < clamped)
      scoresBase[sty] = clamped;
  }

  const traitScoresRaw = ai?.trait_scores;
  const trait_scores =
    Array.isArray(traitScoresRaw) && traitScoresRaw.length > 0
      ? (traitScoresRaw as unknown[])
          .map(t => {
            const item = t as Record<string, unknown>;
            return {
              label: String((item?.label as string) ?? ''),
              score: Number(item?.score ?? 0),
            };
          })
          .filter(t => t.label)
      : [];

  const child_quote =
    typeof ai?.child_quote === 'string' && ai.child_quote.trim()
      ? ai.child_quote.trim()
      : '';
  const parent_note =
    typeof ai?.parent_note === 'string' && ai.parent_note.trim()
      ? ai.parent_note.trim()
      : '';

  const profile = {
    ...base,
    category: categoryKey,
    name: base.name,
    traits,
    description,
    famous_people,
    strengths,
    growth_areas,
    trait_scores,
    child_quote,
    parent_note,
  };

  return {
    type: dominant,
    scores: scoresBase,
    profile,
  };
}

export interface MbtiResult {
  type?: string;
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
