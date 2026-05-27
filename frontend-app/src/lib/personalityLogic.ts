import { personalizedDescriptionOneLiner } from './personalizedDescriptionOneLiner';
import { generateAvatarDataUri } from './avatarUtils';

export const personalityCategories: Record<string, { name: string; color: string; description: string }> = {
  motivators: { name: 'Motivators', color: 'from-red-500 to-orange-600', description: 'Driven by goals, ambition, and achievement' },
  socializers: { name: 'Socializers', color: 'from-yellow-400 to-orange-500', description: 'Energized by people and connection' },
  creatives: { name: 'Creatives', color: 'from-purple-400 to-pink-500', description: 'Inspired by imagination and expression' },
  adventurers: { name: 'Adventurers', color: 'from-orange-400 to-red-500', description: 'Seeking variety and new experiences' },
};

interface FamousPerson { name: string; image?: string; }

interface PersonalityTypeEntry {
  name: string; category: string; traits: string[]; description: string;
  famous_people: FamousPerson[]; color: string; strengths: string[]; growth_areas: string[];
}

export const personalityTypes: Record<string, PersonalityTypeEntry> = {
  Ambitious: { name: 'Ambitious', category: 'motivators', traits: ['Goal-oriented','Driven','Competitive','Persistent','Forward-thinking'], description: '{childName} sets high standards, aims big, and is motivated by achieving success.', famous_people: [{name:'Serena Williams',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Serena_Williams_2013.jpg/220px-Serena_Williams_2013.jpg'},{name:'Elon Musk',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Elon_Musk_Royal_Society_%28crop2%29.jpg/220px-Elon_Musk_Royal_Society_%28crop2%29.jpg'}], color: 'from-red-500 to-pink-600', strengths: ['Persistence','High standards','Focus on goals','Motivation'], growth_areas: ['Patience','Managing stress','Flexibility in approach'] },
  Determined: { name: 'Determined', category: 'motivators', traits: ['Focused','Hardworking','Resilient','Patient','Goal-oriented'], description: '{childName} shows strong persistence and is motivated to finish what they start.', famous_people: [{name:'Thomas Edison',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Thomas_Edison2.jpg/220px-Thomas_Edison2.jpg'},{name:'Malala Yousafzai',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Malala_Yousafzai_at_Girl_Summit_2014-_cropped.jpg/220px-Malala_Yousafzai_at_Girl_Summit_2014-_cropped.jpg'}], color: 'from-orange-500 to-red-600', strengths: ['Persistence','Goal completion','Hard work','Motivation under pressure'], growth_areas: ['Flexibility','Handling setbacks calmly','Seeking help when needed'] },
  Outgoing: { name: 'Outgoing', category: 'socializers', traits: ['Friendly','Sociable','Confident','Energetic','Engaging'], description: '{childName} thrives in social settings and energizes others through their presence.', famous_people: [{name:'Oprah Winfrey',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Oprah_in_2014.jpg/220px-Oprah_in_2014.jpg'},{name:'Will Smith',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Will_Smith_2011.jpg/220px-Will_Smith_2011.jpg'}], color: 'from-yellow-400 to-orange-500', strengths: ['Networking','Communication','Confidence','Positive energy'], growth_areas: ['Listening skills','Sensitivity to introverts','Managing overstimulation'] },
  Creative: { name: 'Creative', category: 'creatives', traits: ['Imaginative','Inventive','Curious','Expressive','Resourceful'], description: '{childName} enjoys creating, imagining new possibilities, and finding unique solutions.', famous_people: [{name:'Leonardo da Vinci',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Leonardo_self.jpg/220px-Leonardo_self.jpg'},{name:'Frida Kahlo',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Frida_Kahlo%2C_by_Guillermo_Kahlo.jpg/220px-Frida_Kahlo%2C_by_Guillermo_Kahlo.jpg'}], color: 'from-purple-400 to-pink-500', strengths: ['Imagination','Problem-solving','Adaptability','Artistic skills'], growth_areas: ['Practical implementation','Time management','Accepting criticism'] },
  Enthusiastic: { name: 'Enthusiastic', category: 'motivators', traits: ['Excitable','Optimistic','Eager','Passionate','Energetic'], description: '{childName} approaches new experiences with eagerness and brings energy to their surroundings.', famous_people: [{name:'Robin Williams',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Robin_Williams_2011a_%282%29.jpg/220px-Robin_Williams_2011a_%282%29.jpg'},{name:'Ellen DeGeneres',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Ellen_DeGeneres_2011.jpg/220px-Ellen_DeGeneres_2011.jpg'}], color: 'from-emerald-400 to-yellow-500', strengths: ['Positive energy','Motivation','Inspiration to others','Optimism'], growth_areas: ['Focusing energy','Patience','Managing disappointment'] },
  Restless: { name: 'Restless', category: 'adventurers', traits: ['Curious','Impatient','Varied interests','Energetic','Quick-moving'], description: '{childName} prefers variety and fast-paced activities and seeks new experiences.', famous_people: [{name:'Richard Branson',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Richard_Branson_2011.jpg/220px-Richard_Branson_2011.jpg'},{name:'Bear Grylls',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Bear_Grylls_at_the_Webby_Awards.jpg/220px-Bear_Grylls_at_the_Webby_Awards.jpg'}], color: 'from-orange-400 to-red-500', strengths: ['Adaptability','Energy','Variety-seeking','Quick learning'], growth_areas: ['Patience','Long-term focus','Consistency'] },
  'Highly Energetic': { name: 'Highly Energetic', category: 'motivators', traits: ['Active','Vibrant','Enthusiastic','Persistent','Alert'], description: '{childName} has a high energy level and can engage in multiple activities with stamina.', famous_people: [{name:'Serena Williams',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Serena_Williams_2013.jpg/220px-Serena_Williams_2013.jpg'},{name:'Dwayne Johnson',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Dwayne_Johnson_2014.jpg/220px-Dwayne_Johnson_2014.jpg'}], color: 'from-red-500 to-yellow-500', strengths: ['Stamina','Multitasking','Enthusiasm','Persistence'], growth_areas: ['Rest and recovery','Focus','Patience with slower activities'] },
  Thinker: { name: 'Thinker', category: 'creatives', traits: ['Curious','Analytical','Observant','Thoughtful','Problem-solver'], description: '{childName} enjoys thinking deeply, solving problems, and asking questions.', famous_people: [{name:'Albert Einstein',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/220px-Albert_Einstein_Head.jpg'},{name:'Marie Curie',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Marie_Curie_c1920.jpg/220px-Marie_Curie_c1920.jpg'}], color: 'from-blue-400 to-indigo-500', strengths: ['Analytical thinking','Problem-solving','Curiosity','Reflection'], growth_areas: ['Action-taking','Practical application','Social interaction'] },
  Playful: { name: 'Playful', category: 'socializers', traits: ['Joyful','Silly','Energetic','Curious','Spontaneous'], description: '{childName} brings fun and joy to situations and approaches life with a light-hearted spirit.', famous_people: [{name:'Jim Carrey',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Jim_Carrey_2011.jpg/220px-Jim_Carrey_2011.jpg'},{name:'Robin Williams',image:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Robin_Williams_2011a_%282%29.jpg/220px-Robin_Williams_2011a_%282%29.jpg'}], color: 'from-pink-400 to-purple-500', strengths: ['Humor','Joy','Creativity','Social engagement'], growth_areas: ['Focus','Handling serious tasks','Patience'] },
};

export const PERSONALITY_TYPE_KEYS = Object.keys(personalityTypes);

export interface CalculateMbtiData {
  energy_level?: string; thinking_pattern?: string; communication_style?: string;
  social_behaviour?: string; emotional_behaviour?: string; name?: string;
}

export function calculateMBTI(data: CalculateMbtiData) {
  const scores: Record<string, number> = { Ambitious:0, Determined:0, Outgoing:0, Creative:0, Enthusiastic:0, Restless:0, 'Highly Energetic':0, Thinker:0, Playful:0 };

  if (data.energy_level === 'High energy - always active') { scores['Highly Energetic']! += 3; scores['Restless']! += 2; scores['Enthusiastic']! += 2; }
  else if (data.energy_level === 'Moderate - balanced') { scores['Determined']! += 2; scores['Ambitious']! += 1; }
  else if (data.energy_level === 'Calm and composed') { scores['Thinker']! += 3; scores['Creative']! += 1; }
  else { scores['Restless']! += 2; scores['Highly Energetic']! += 1; }

  if (data.thinking_pattern === 'Visual') { scores['Creative']! += 2; scores['Thinker']! += 1; }
  else if (data.thinking_pattern === 'Analytical') { scores['Thinker']! += 3; scores['Ambitious']! += 2; }
  else if (data.thinking_pattern === 'Imaginative') { scores['Creative']! += 3; scores['Playful']! += 1; }
  else { scores['Creative']! += 1; }

  if (data.communication_style === 'Talkative') { scores['Outgoing']! += 3; scores['Enthusiastic']! += 2; }
  else if (data.communication_style === 'Deep Listener') { scores['Thinker']! += 2; scores['Determined']! += 1; }
  else if (data.communication_style === 'Communicates through gestures') { scores['Creative']! += 2; }
  else if (data.communication_style === 'Silent') { scores['Thinker']! += 3; }
  else if (data.communication_style === 'Observant') { scores['Thinker']! += 2; scores['Creative']! += 1; }

  if (data.social_behaviour === 'Confident') { scores['Outgoing']! += 3; scores['Ambitious']! += 2; }
  else if (data.social_behaviour === 'Friendly') { scores['Outgoing']! += 2; scores['Enthusiastic']! += 2; scores['Playful']! += 1; }
  else if (data.social_behaviour === 'Reserved') { scores['Thinker']! += 2; scores['Creative']! += 1; }
  else if (data.social_behaviour === 'Expressive') { scores['Enthusiastic']! += 2; scores['Playful']! += 2; scores['Creative']! += 1; }
  else if (data.social_behaviour === 'Withdrawn') { scores['Thinker']! += 3; scores['Creative']! += 1; }

  if (data.emotional_behaviour === 'Calm') { scores['Thinker']! += 2; scores['Determined']! += 2; }
  else if (data.emotional_behaviour === 'Sensitive') { scores['Creative']! += 2; scores['Enthusiastic']! += 1; }
  else if (data.emotional_behaviour === 'Reserved') { scores['Thinker']! += 2; scores['Determined']! += 1; }
  else if (data.emotional_behaviour === 'Impulsive') { scores['Restless']! += 3; scores['Playful']! += 2; scores['Highly Energetic']! += 1; }
  else if (data.emotional_behaviour === 'Moody') { scores['Creative']! += 2; scores['Restless']! += 1; }

  let maxScore = 0; let dominantType = 'Creative';
  Object.entries(scores).forEach(([type, score]) => { if (score > maxScore) { maxScore = score; dominantType = type; } });
  const profile = personalityTypes[dominantType] ?? personalityTypes['Creative']!;
  return { type: dominantType, scores, profile: { ...profile, description: profile.description.replace('{childName}', data.name ?? 'Your child') } };
}

interface AiPersonalityInput {
  dominant_style?: unknown; personality_category?: unknown; personalized_traits?: unknown;
  personalized_description?: unknown; strength_summary_bullets?: unknown;
  personalized_growth_areas?: unknown; role_models?: unknown; secondary_styles?: unknown;
}

const PERSONALITY_CATEGORY_KEYS = ['motivators', 'socializers', 'creatives', 'adventurers'];

function roleModelAvatars(roleModels: unknown, fallbackName: string | undefined): FamousPerson[] {
  const list = Array.isArray(roleModels) ? (roleModels as Array<Record<string, unknown>>) : [];
  const two = [...list.slice(0, 2)];
  while (two.length < 2) two.push({ name: two.length === 0 ? (fallbackName ?? 'Role model A') : 'Role model B' });
  return two.map((r) => { const nm = typeof r?.name === 'string' && r.name.trim() ? r.name.trim() : 'Guide'; return { name: nm, image: generateAvatarDataUri(nm) }; });
}

export function adaptAiPersonalityToViewModel(ai: AiPersonalityInput, childName: string | undefined) {
  const safeName = childName?.trim?.() ? childName.trim() : 'your child';
  const dominant: string = typeof ai?.dominant_style === 'string' && PERSONALITY_TYPE_KEYS.includes(ai.dominant_style) ? ai.dominant_style : 'Creative';
  const categoryKey: string = typeof ai?.personality_category === 'string' && PERSONALITY_CATEGORY_KEYS.includes(ai.personality_category) ? ai.personality_category : (personalityTypes[dominant]?.category ?? 'creatives');
  const base = personalityTypes[dominant] ?? personalityTypes['Creative']!;
  const traitsRaw = ai?.personalized_traits;
  const traits = Array.isArray(traitsRaw) && traitsRaw.length > 0 ? (traitsRaw as unknown[]).map((t) => String(t)).filter(Boolean) : base.traits;
  const rawDesc = typeof ai?.personalized_description === 'string' ? ai.personalized_description.trim() : '';
  const description = rawDesc ? personalizedDescriptionOneLiner(rawDesc.replace(/\{childName\}/gi, safeName).replace(/\btheir\b/gi, `${safeName}'s`)) : base.description.replace('{childName}', safeName);
  const strengthsRaw = ai?.strength_summary_bullets;
  const strengths = Array.isArray(strengthsRaw) && strengthsRaw.length > 0 ? (strengthsRaw as unknown[]).map((t) => String(t)).filter(Boolean) : base.strengths;
  const gaRaw = ai?.personalized_growth_areas;
  const growth_areas = Array.isArray(gaRaw) && gaRaw.length > 0 ? (gaRaw as unknown[]).map((t) => String(t)).filter(Boolean) : base.growth_areas;
  const famous_people = roleModelAvatars(ai?.role_models, safeName);
  const scoresBase: Record<string, number> = PERSONALITY_TYPE_KEYS.reduce((acc, key) => { acc[key] = 14; return acc; }, {} as Record<string, number>);
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
  return { type: dominant, scores: scoresBase, profile: { ...base, category: categoryKey, traits, description, famous_people, strengths, growth_areas } };
}

export interface MbtiResult {
  type: string;
  scores: Record<string, number>;
  profile: { name?: string; category?: string; traits?: string[]; description?: string; famous_people?: FamousPerson[]; strengths?: string[]; growth_areas?: string[]; color?: string; };
}
