import { motion } from 'framer-motion';
import { Target, Users, Lightbulb, Heart, Zap, Sparkles, Sprout } from 'lucide-react';
import { personalizedDescriptionOneLiner } from '@/lib/personalizedDescriptionOneLiner';

// New Personality Framework
const personalityCategories = {
  motivators: { name: 'Motivators', color: 'from-red-500 to-orange-600', description: 'Driven by goals, ambition, and achievement' },
  socializers: { name: 'Socializers', color: 'from-yellow-400 to-orange-500', description: 'Energized by people and connection' },
  creatives: { name: 'Creatives', color: 'from-purple-400 to-pink-500', description: 'Inspired by imagination and expression' },
  adventurers: { name: 'Adventurers', color: 'from-orange-400 to-red-500', description: 'Seeking variety and new experiences' }
};

const personalityTypes = {
  Ambitious: {
    name: "Ambitious",
    category: "motivators",
    traits: ["Goal-oriented", "Driven", "Competitive", "Persistent", "Forward-thinking"],
    description: "{childName} sets high standards, aims big, and is motivated by achieving success. They connect effort today with future goals and are energized by challenges.",
    famous_people: [
      { name: "Serena Williams", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Serena_Williams_2013.jpg/220px-Serena_Williams_2013.jpg" },
      { name: "Elon Musk", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Elon_Musk_Royal_Society_%28crop2%29.jpg/220px-Elon_Musk_Royal_Society_%28crop2%29.jpg" }
    ],
    color: "from-red-500 to-pink-600",
    strengths: ["Persistence", "High standards", "Focus on goals", "Motivation"],
    growth_areas: ["Patience", "Managing stress", "Flexibility in approach"]
  },
  Determined: {
    name: "Determined",
    category: "motivators",
    traits: ["Focused", "Hardworking", "Resilient", "Patient", "Goal-oriented"],
    description: "{childName} shows strong persistence, continues even in the face of difficulty, and is motivated to finish what they start.",
    famous_people: [
      { name: "Thomas Edison", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Thomas_Edison2.jpg/220px-Thomas_Edison2.jpg" },
      { name: "Malala Yousafzai", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Malala_Yousafzai_at_Girl_Summit_2014-_cropped.jpg/220px-Malala_Yousafzai_at_Girl_Summit_2014-_cropped.jpg" }
    ],
    color: "from-orange-500 to-red-600",
    strengths: ["Persistence", "Goal completion", "Hard work", "Motivation under pressure"],
    growth_areas: ["Flexibility", "Handling setbacks calmly", "Seeking help when needed"]
  },
  Outgoing: {
    name: "Outgoing",
    category: "socializers",
    traits: ["Friendly", "Sociable", "Confident", "Energetic", "Engaging"],
    description: "{childName} thrives in social settings, enjoys meeting new people, and energizes others through their presence and enthusiasm.",
    famous_people: [
      { name: "Oprah Winfrey", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Oprah_in_2014.jpg/220px-Oprah_in_2014.jpg" },
      { name: "Will Smith", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Will_Smith_2011.jpg/220px-Will_Smith_2011.jpg" }
    ],
    color: "from-yellow-400 to-orange-500",
    strengths: ["Networking", "Communication", "Confidence", "Positive energy"],
    growth_areas: ["Listening skills", "Sensitivity to introverts", "Managing overstimulation"]
  },
  Creative: {
    name: "Creative",
    category: "creatives",
    traits: ["Imaginative", "Inventive", "Curious", "Expressive", "Resourceful"],
    description: "{childName} enjoys creating, imagining new possibilities, and finding unique solutions. They are inspired by self-expression and novel ideas.",
    famous_people: [
      { name: "Leonardo da Vinci", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Leonardo_self.jpg/220px-Leonardo_self.jpg" },
      { name: "Frida Kahlo", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Frida_Kahlo%2C_by_Guillermo_Kahlo.jpg/220px-Frida_Kahlo%2C_by_Guillermo_Kahlo.jpg" }
    ],
    color: "from-purple-400 to-pink-500",
    strengths: ["Imagination", "Problem-solving", "Adaptability", "Artistic skills"],
    growth_areas: ["Practical implementation", "Time management", "Accepting criticism"]
  },
  Enthusiastic: {
    name: "Enthusiastic",
    category: "motivators",
    traits: ["Excitable", "Optimistic", "Eager", "Passionate", "Energetic"],
    description: "{childName} approaches new experiences with eagerness, expresses joy openly, and brings energy to their surroundings.",
    famous_people: [
      { name: "Robin Williams", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Robin_Williams_2011a_%282%29.jpg/220px-Robin_Williams_2011a_%282%29.jpg" },
      { name: "Ellen DeGeneres", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Ellen_DeGeneres_2011.jpg/220px-Ellen_DeGeneres_2011.jpg" }
    ],
    color: "from-emerald-400 to-yellow-500",
    strengths: ["Positive energy", "Motivation", "Inspiration to others", "Optimism"],
    growth_areas: ["Focusing energy", "Patience", "Managing disappointment"]
  },
  Restless: {
    name: "Restless",
    category: "adventurers",
    traits: ["Curious", "Impatient", "Varied interests", "Energetic", "Quick-moving"],
    description: "{childName} prefers variety and fast-paced activities, seeks new experiences, and gets bored when things are slow or repetitive.",
    famous_people: [
      { name: "Richard Branson", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Richard_Branson_2011.jpg/220px-Richard_Branson_2011.jpg" },
      { name: "Bear Grylls", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Bear_Grylls_at_the_Webby_Awards.jpg/220px-Bear_Grylls_at_the_Webby_Awards.jpg" }
    ],
    color: "from-orange-400 to-red-500",
    strengths: ["Adaptability", "Energy", "Variety-seeking", "Quick learning"],
    growth_areas: ["Patience", "Long-term focus", "Consistency"]
  },
  "Highly Energetic": {
    name: "Highly Energetic",
    category: "motivators",
    traits: ["Active", "Vibrant", "Enthusiastic", "Persistent", "Alert"],
    description: "{childName} has a high energy level, enjoys being active, and can engage in multiple activities with stamina and vitality.",
    famous_people: [
      { name: "Serena Williams", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Serena_Williams_2013.jpg/220px-Serena_Williams_2013.jpg" },
      { name: "Dwayne Johnson", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Dwayne_Johnson_2014.jpg/220px-Dwayne_Johnson_2014.jpg" }
    ],
    color: "from-red-500 to-yellow-500",
    strengths: ["Stamina", "Multitasking", "Enthusiasm", "Persistence"],
    growth_areas: ["Rest and recovery", "Focus", "Patience with slower activities"]
  },
  Thinker: {
    name: "Thinker",
    category: "creatives",
    traits: ["Curious", "Analytical", "Observant", "Thoughtful", "Problem-solver"],
    description: "{childName} enjoys thinking deeply, solving problems, asking questions, and reflecting on experiences.",
    famous_people: [
      { name: "Albert Einstein", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/220px-Albert_Einstein_Head.jpg" },
      { name: "Marie Curie", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Marie_Curie_c1920.jpg/220px-Marie_Curie_c1920.jpg" }
    ],
    color: "from-blue-400 to-indigo-500",
    strengths: ["Analytical thinking", "Problem-solving", "Curiosity", "Reflection"],
    growth_areas: ["Action-taking", "Practical application", "Social interaction"]
  },
  Playful: {
    name: "Playful",
    category: "socializers",
    traits: ["Joyful", "Silly", "Energetic", "Curious", "Spontaneous"],
    description: "{childName} brings fun and joy to situations, enjoys games and surprises, and approaches life with a light-hearted spirit.",
    famous_people: [
      { name: "Jim Carrey", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Jim_Carrey_2011.jpg/220px-Jim_Carrey_2011.jpg" },
      { name: "Robin Williams", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Robin_Williams_2011a_%282%29.jpg/220px-Robin_Williams_2011a_%282%29.jpg" }
    ],
    color: "from-pink-400 to-purple-500",
    strengths: ["Humor", "Joy", "Creativity", "Social engagement"],
    growth_areas: ["Focus", "Handling serious tasks", "Patience"]
  }
};

export function calculateMBTI(data) {
  let scores = {
    Ambitious: 0,
    Determined: 0,
    Outgoing: 0,
    Creative: 0,
    Enthusiastic: 0,
    Restless: 0,
    "Highly Energetic": 0,
    Thinker: 0,
    Playful: 0
  };

  // Energy level
  if (data.energy_level === 'High energy - always active') {
    scores["Highly Energetic"] += 3;
    scores.Restless += 2;
    scores.Enthusiastic += 2;
  } else if (data.energy_level === 'Moderate - balanced') {
    scores.Determined += 2;
    scores.Ambitious += 1;
  } else if (data.energy_level === 'Calm and composed') {
    scores.Thinker += 3;
    scores.Creative += 1;
  } else {
    scores.Restless += 2;
    scores["Highly Energetic"] += 1;
  }

  // Thinking pattern
  if (data.thinking_pattern === 'Visual') {
    scores.Creative += 2;
    scores.Thinker += 1;
  } else if (data.thinking_pattern === 'Analytical') {
    scores.Thinker += 3;
    scores.Ambitious += 2;
  } else if (data.thinking_pattern === 'Imaginative') {
    scores.Creative += 3;
    scores.Playful += 1;
  } else {
    scores.Creative += 1;
  }

  // Communication style
  if (data.communication_style === 'Talkative') {
    scores.Outgoing += 3;
    scores.Enthusiastic += 2;
  } else if (data.communication_style === 'Deep Listener') {
    scores.Thinker += 2;
    scores.Determined += 1;
  } else if (data.communication_style === 'Communicates through gestures') {
    scores.Creative += 2;
  } else if (data.communication_style === 'Silent') {
    scores.Thinker += 3;
  } else if (data.communication_style === 'Observant') {
    scores.Thinker += 2;
    scores.Creative += 1;
  }

  // Social behaviour
  if (data.social_behaviour === 'Confident') {
    scores.Outgoing += 3;
    scores.Ambitious += 2;
  } else if (data.social_behaviour === 'Friendly') {
    scores.Outgoing += 2;
    scores.Enthusiastic += 2;
    scores.Playful += 1;
  } else if (data.social_behaviour === 'Reserved') {
    scores.Thinker += 2;
    scores.Creative += 1;
  } else if (data.social_behaviour === 'Expressive') {
    scores.Enthusiastic += 2;
    scores.Playful += 2;
    scores.Creative += 1;
  } else if (data.social_behaviour === 'Withdrawn') {
    scores.Thinker += 3;
    scores.Creative += 1;
  }

  // Emotional behaviour
  if (data.emotional_behaviour === 'Calm') {
    scores.Thinker += 2;
    scores.Determined += 2;
  } else if (data.emotional_behaviour === 'Sensitive') {
    scores.Creative += 2;
    scores.Enthusiastic += 1;
  } else if (data.emotional_behaviour === 'Reserved') {
    scores.Thinker += 2;
    scores.Determined += 1;
  } else if (data.emotional_behaviour === 'Impulsive') {
    scores.Restless += 3;
    scores.Playful += 2;
    scores["Highly Energetic"] += 1;
  } else if (data.emotional_behaviour === 'Moody') {
    scores.Creative += 2;
    scores.Restless += 1;
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

  const profile = personalityTypes[dominantType];

  return {
    type: dominantType,
    scores,
    profile: {
      ...profile,
      description: profile.description.replace('{childName}', data.name || 'Your child')
    }
  };
}

const PERSONALITY_TYPE_KEYS = Object.keys(personalityTypes);
const PERSONALITY_CATEGORY_KEYS = ['motivators', 'socializers', 'creatives', 'adventurers'];

function roleModelAvatars(roleModels, fallbackName) {
  const list = Array.isArray(roleModels) ? roleModels : [];
  const two = [...list.slice(0, 2)];
  while (two.length < 2) {
    two.push({ name: two.length === 0 ? fallbackName || 'Role model A' : 'Role model B' });
  }
  return two.map((r) => {
    const nm = typeof r?.name === 'string' && r.name.trim() ? r.name.trim() : 'Guide';
    return {
      name: nm,
      image: `https://ui-avatars.com/api/?name=${encodeURIComponent(nm)}&background=random&size=128`,
    };
  });
}

/**
 * Builds the same `{ type, scores, profile }` shape rule-based onboarding uses so the Personality UI renders unchanged.
 * @param {Record<string, unknown>} ai Parsed LLM JSON
 * @param {string} childName
 */
export function adaptAiPersonalityToViewModel(ai, childName) {
  const safeName = childName?.trim?.() ? childName.trim() : 'your child';

  let dominant =
    typeof ai?.dominant_style === 'string' && PERSONALITY_TYPE_KEYS.includes(ai.dominant_style)
      ? ai.dominant_style
      : 'Creative';
  let categoryKey =
    typeof ai?.personality_category === 'string' && PERSONALITY_CATEGORY_KEYS.includes(ai.personality_category)
      ? ai.personality_category
      : personalityTypes[dominant].category;

  const base = personalityTypes[dominant];

  const traitsRaw = ai?.personalized_traits;
  const traits =
    Array.isArray(traitsRaw) && traitsRaw.length > 0
      ? traitsRaw.map((t) => String(t)).filter(Boolean)
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
      ? strengthsRaw.map((t) => String(t)).filter(Boolean)
      : base.strengths;

  const gaRaw = ai?.personalized_growth_areas;
  const growth_areas =
    Array.isArray(gaRaw) && gaRaw.length > 0
      ? gaRaw.map((t) => String(t)).filter(Boolean)
      : base.growth_areas;

  const famous_people = roleModelAvatars(ai?.role_models, safeName);

  const scoresBase = PERSONALITY_TYPE_KEYS.reduce((acc, key) => {
    acc[key] = 14;
    return acc;
  }, {});
  scoresBase[dominant] = 100;

  const secondaries = Array.isArray(ai.secondary_styles) ? ai.secondary_styles : [];
  for (let i = 0; i < secondaries.length && i < 2; i++) {
    const sty = typeof secondaries[i]?.personality_style === 'string' ? secondaries[i].personality_style : '';
    if (!PERSONALITY_TYPE_KEYS.includes(sty) || sty === dominant) continue;
    const prom = typeof secondaries[i]?.prominence === 'number' ? secondaries[i].prominence : 72;
    const clamped = Math.max(42, Math.min(96, Number.isFinite(prom) ? prom : 72));
    if (!scoresBase[sty] || scoresBase[sty] < clamped) scoresBase[sty] = clamped;
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

export default function PersonalityAnalysis({ mbtiResult, childName }) {
  const { type, scores, profile } = mbtiResult;
  const category = personalityCategories[profile?.category] || personalityCategories.creatives;

  // Get top 3 personality types by score
  const topTypes = Object.entries(scores)
    .filter(([typeName]) => personalityTypes[typeName]) // Only include valid types
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([typeName, score]) => ({ name: typeName, score }));

  const growthAreasList = Array.isArray(profile?.growth_areas) ? profile.growth_areas : [];

  const sectionAnim = (delay) => ({
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 1.0, delay, ease: 'easeOut' },
  });

  return (
    <div className="space-y-6">
      {/* Section 1 — Category Badge */}
      <motion.div
        {...sectionAnim(0.1)}
        className={`bg-gradient-to-r ${category.color} rounded-2xl p-4 text-white text-center`}
      >
        <p className="text-sm font-medium opacity-90">{category.name}</p>
        <p className="text-xs opacity-75 mt-1">{category.description}</p>
      </motion.div>

      {/* Section 2 — Main Type Card */}
      <motion.div
        {...sectionAnim(0.8)}
        className="bg-[#141414] rounded-2xl p-6 border border-white/[0.08]"
      >
        <div className="text-center mb-4">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Sparkles className="w-6 h-6 text-teal-400" />
            <h3 className="text-2xl font-bold text-white">{profile.name}</h3>
          </div>
          <p className="text-slate-500 text-sm">{childName}'s personality type</p>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mb-4">
          {profile.traits.map((trait, i) => (
            <motion.span
              key={trait}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 1.0 + i * 0.2 }}
              className="px-3 py-1 bg-white/[0.06] text-slate-300 rounded-full text-xs border border-white/[0.06]"
            >
              {trait}
            </motion.span>
          ))}
        </div>

        <p className="text-slate-400 text-sm text-center leading-relaxed">
          {profile.description}
        </p>
      </motion.div>

      {/* Section 3 — Personality Profile Breakdown */}
      <motion.div
        {...sectionAnim(1.6)}
        className="bg-[#141414] rounded-2xl p-6 border border-white/[0.08]"
      >
        <h4 className="font-semibold text-white mb-4 text-sm">Personality Profile Breakdown</h4>
        <div className="space-y-4">
          {topTypes.map((item, index) => {
            const maxScore = topTypes[0].score;
            const percentage = maxScore > 0 ? (item.score / maxScore) * 100 : 0;
            const itemProfile = personalityTypes[item.name];
            if (!itemProfile) return null;
            return (
              <motion.div
                key={item.name}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 1.9 + index * 0.25 }}
              >
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-300">{itemProfile.name}</span>
                  <span className="text-slate-500">{Math.round(percentage)}%</span>
                </div>
                <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    transition={{ duration: 2.4, delay: 2.0 + index * 0.3, ease: 'easeInOut' }}
                    className={`h-full bg-gradient-to-r ${itemProfile.color} rounded-full`}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Section 4 — Famous People */}
      <motion.div
        {...sectionAnim(2.4)}
        className="bg-[#1a1a1a] rounded-2xl p-6 border border-white/[0.08]"
      >
        <h4 className="font-semibold text-white mb-1 text-sm">Famous {
          profile.name === 'Ambitious' ? 'Achievers' :
          profile.name === 'Determined' ? 'Strivers' :
          profile.name === 'Outgoing' ? 'Socializers' :
          profile.name === 'Creative' ? 'Creators' :
          profile.name === 'Enthusiastic' ? 'Enthusiasts' :
          profile.name === 'Restless' ? 'Explorers' :
          profile.name === 'Highly Energetic' ? 'Energizers' :
          profile.name === 'Thinker' ? 'Thinkers' :
          profile.name === 'Playful' ? 'Players' :
          profile.name + 's'
        }</h4>
        <p className="text-xs text-slate-500 mb-5">People {childName} may relate to</p>
        <div className="flex flex-wrap justify-center gap-6">
          {profile.famous_people.map((person, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 2.7 + i * 0.3 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/[0.10]">
                <img
                  src={person.image}
                  alt={person.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(person.name)}&background=1a1a1a&color=2dd4bf&size=128`;
                  }}
                />
              </div>
              <span className="text-xs text-slate-400 text-center font-medium max-w-[80px] leading-tight">
                {person.name}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Section 5 — Strengths */}
      <motion.div
        {...sectionAnim(3.2)}
        className="bg-[#141414] rounded-2xl p-5 border border-emerald-500/15"
      >
        <h4 className="font-semibold text-emerald-400 mb-3 text-sm">💪 Strengths</h4>
        <ul className="space-y-2">
          {profile.strengths.map((s, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 3.5 + i * 0.15 }}
              className="text-sm text-slate-400 flex items-center gap-2.5"
            >
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0" />
              {s}
            </motion.li>
          ))}
        </ul>
      </motion.div>

      {/* Section 6 — Growth Areas */}
      {growthAreasList.length > 0 && (
        <motion.div
          {...sectionAnim(4.0)}
          className="bg-[#141414] rounded-2xl p-5 border border-amber-500/15"
        >
          <h4 className="font-semibold text-amber-400 mb-3 flex items-center gap-2 text-sm">
            <Sprout className="w-4 h-4 shrink-0" aria-hidden />
            Growth Areas
          </h4>
          <ul className="space-y-2">
            {growthAreasList.map((item, i) => (
              <motion.li
                key={`${item}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.7, delay: 4.3 + i * 0.15 }}
                className="text-sm text-slate-400 flex items-start gap-2.5"
              >
                <span className="w-1.5 h-1.5 mt-1.5 bg-amber-500 rounded-full shrink-0" aria-hidden />
                <span>{item}</span>
              </motion.li>
            ))}
          </ul>
        </motion.div>
      )}
    </div>
  );
}

export { personalityTypes, personalityCategories, PERSONALITY_TYPE_KEYS };