import { Rocket, Heart, Brain, Palette, Dumbbell, MessageSquare } from 'lucide-react';

// ─── Name, pronoun and verb-agreement templating ──────────────────────────────
// Question, hint and archetype copy is authored with tokens rather than a fixed
// gender, because the source design was written entirely in "he" and reads
// wrong for anyone else.
//
//   {name}                            the child's first name
//   {he} {his} {him} {himself}        pronouns (+ capitalised forms)
//   {is} {does} {has} {was}           agreement-sensitive auxiliaries
//   {s} {es} {ies}                    third-person verb endings
//
// The endings matter for singular "they": "{he} want{s}" renders as
// "he wants" / "she wants" / "they want". Without them the neutral voice
// produces "they wants". Only verbs whose SUBJECT is the pronoun carry a
// token — where the subject is {name}, agreement stays singular for everyone
// ("How does {name} behave when {he} join{s} …").

export interface CopyTokens {
  he: string;
  He: string;
  his: string;
  His: string;
  him: string;
  Him: string;
  himself: string;
  Himself: string;
  is: string;
  Is: string;
  does: string;
  Does: string;
  has: string;
  Has: string;
  was: string;
  Was: string;
  /** third-person singular verb endings — empty in the neutral voice */
  s: string;
  es: string;
  ies: string;
}

const MASCULINE: CopyTokens = {
  he: 'he',
  He: 'He',
  his: 'his',
  His: 'His',
  him: 'him',
  Him: 'Him',
  himself: 'himself',
  Himself: 'Himself',
  is: 'is',
  Is: 'Is',
  does: 'does',
  Does: 'Does',
  has: 'has',
  Has: 'Has',
  was: 'was',
  Was: 'Was',
  s: 's',
  es: 'es',
  ies: 'ies',
};

const FEMININE: CopyTokens = {
  he: 'she',
  He: 'She',
  his: 'her',
  His: 'Her',
  him: 'her',
  Him: 'Her',
  himself: 'herself',
  Himself: 'Herself',
  is: 'is',
  Is: 'Is',
  does: 'does',
  Does: 'Does',
  has: 'has',
  Has: 'Has',
  was: 'was',
  Was: 'Was',
  s: 's',
  es: 'es',
  ies: 'ies',
};

// Singular "they" takes plural verb forms: they are / they do / they have.
const NEUTRAL: CopyTokens = {
  he: 'they',
  He: 'They',
  his: 'their',
  His: 'Their',
  him: 'them',
  Him: 'Them',
  himself: 'themselves',
  Himself: 'Themselves',
  is: 'are',
  Is: 'Are',
  does: 'do',
  Does: 'Do',
  has: 'have',
  Has: 'Have',
  was: 'were',
  Was: 'Were',
  s: '',
  es: '',
  ies: 'y',
};

/** Gender comes from ChildProfileStep: 'Male' | 'Female' | 'Other' | ''.
 *  'Other', empty and missing all resolve to the neutral voice. */
export function copyTokensFor(gender?: string | null): CopyTokens {
  const g = gender?.trim().toLowerCase();
  if (g === 'male') return MASCULINE;
  if (g === 'female') return FEMININE;
  return NEUTRAL;
}

/**
 * Resolve {name} and voice tokens in a copy string.
 * An unrecognised token is left verbatim rather than blanked, so a typo shows
 * up in review instead of silently opening a gap mid-sentence.
 */
export function fillTemplate(
  text: string,
  childName?: string | null,
  gender?: string | null,
): string {
  const tokens = copyTokensFor(gender) as unknown as Record<string, string>;
  const trimmed = childName?.trim() ?? '';
  const name = trimmed === '' ? 'your child' : trimmed;
  return text.replace(/\{(\w+)\}/g, (whole, slot: string) => {
    if (slot === 'name') return name;
    return tokens[slot] ?? whole;
  });
}

// ─── Growth areas ─────────────────────────────────────────────────────────────

export interface GrowthArea {
  id: string;
  urlName: string;
  name: string;
  /** lucide icon — used by the card/header layouts */
  icon: typeof Rocket;
  /** tailwind gradient stops — used by the card/header layouts */
  color: string;
  description: string;
  /** "r,g,b" triple driving the node glow on the growth map */
  hue: string;
  /** inline SVG path for the growth-map node */
  iconPath: string;
  /** `rgb(var(--growth-*-icon-rgb))` token — see index.css's "GROWTH AREA ICON COLORS" */
  iconColor: string;
  /** node position on the growth-map arc, in percent of the container */
  pos: { left: number; top: number };
}

export const PARENT_QUESTIONS_PER_AREA = 5;
export const GAME_ROUNDS_PER_AREA = 6;

// area `id` and `urlName` are deliberately unchanged from before the redesign:
// stored growth_area documents key on area_id, and existing routes embed urlName.
export const GROWTH_AREAS: GrowthArea[] = [
  {
    id: 'life_ambition',
    urlName: 'LifeAmbition',
    name: 'Life Ambition',
    icon: Rocket,
    color: 'from-personality to-personality-alt-strong',
    description: 'Discovering purpose and future goals',
    hue: '160,120,255',
    iconPath:
      'M11.5 15.5 8.5 12.5c0-5.5 3.5-9.5 9-10.5.5 5.5-3 9.5-9 10.5zM8.5 12.5 6 13l-.8 3 3-.5M11.5 15.5 12 18l3 .8-.5-3',
    iconColor: 'rgb(var(--growth-life-ambition-icon-rgb))',
    pos: { left: 8.0, top: 62.0 },
  },
  {
    id: 'self_care',
    urlName: 'SelfCare',
    name: 'Self Care',
    icon: Heart,
    color: 'from-error-medium to-accent-pink',
    description: 'Building healthy habits and emotional wellness',
    hue: '255,120,170',
    iconPath: 'M12 20s-7-4.4-7-9.3A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.7C19 15.6 12 20 12 20z',
    iconColor: 'rgb(var(--growth-self-care-icon-rgb))',
    pos: { left: 24.8, top: 41.5 },
  },
  {
    id: 'critical_thinking',
    urlName: 'CriticalThinking',
    name: 'Critical Thinking',
    icon: Brain,
    color: 'from-info-medium to-primary-medium',
    description: 'Problem solving and analytical skills',
    hue: '90,170,255',
    iconPath:
      'M12 5a3 3 0 0 0-3 3 2.6 2.6 0 0 0-1.6 4.6A2.8 2.8 0 0 0 9 18h3zM12 5a3 3 0 0 1 3 3 2.6 2.6 0 0 1 1.6 4.6A2.8 2.8 0 0 1 15 18h-3zM12 5v13',
    iconColor: 'rgb(var(--growth-critical-thinking-icon-rgb))',
    pos: { left: 41.6, top: 31.3 },
  },
  {
    id: 'creativity',
    urlName: 'Creativity',
    name: 'Creativity',
    icon: Palette,
    color: 'from-warning-medium to-warning-orange-medium',
    description: 'Imagination and creative expression',
    hue: '255,180,90',
    iconPath:
      'M12 4a8 8 0 0 0 0 16c1.4 0 1.8-1 1.4-2-.5-1.3.3-2.4 1.7-2.4H18a2.6 2.6 0 0 0 2-4.3C18.6 6.4 15.6 4 12 4z',
    iconColor: 'rgb(var(--constellation-amber-rgb))',
    pos: { left: 58.4, top: 31.3 },
  },
  {
    id: 'physical_wellness',
    urlName: 'PhysicalWellness',
    name: 'Physical Wellness',
    icon: Dumbbell,
    color: 'from-success to-primary-dark',
    description: 'Body awareness and physical health',
    hue: '60,225,190',
    iconPath: 'M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10',
    iconColor: 'rgb(var(--growth-physical-wellness-icon-rgb))',
    pos: { left: 75.2, top: 41.5 },
  },
  {
    id: 'social_skills',
    urlName: 'SocialSkills',
    name: 'Social Skills',
    icon: MessageSquare,
    color: 'from-personality-alt to-personality-alt-strong',
    description: 'Communication and relationship building',
    hue: '150,140,255',
    iconPath: 'M20 12a7 7 0 0 1-7 7H9l-4 3 1-4.2A7 7 0 0 1 13 5a7 7 0 0 1 7 7z',
    iconColor: 'rgb(var(--growth-social-skills-icon-rgb))',
    pos: { left: 92.0, top: 62.0 },
  },
];

/** Map URL param name → area definition, e.g. "LifeAmbition" → { id: 'life_ambition', ... } */
export function areaByUrlName(urlName: string): GrowthArea | null {
  return GROWTH_AREAS.find((a) => a.urlName === urlName) ?? null;
}

/** Map area_id → area definition, e.g. "life_ambition" → { id: 'life_ambition', ... } */
export function areaById(id: string): GrowthArea | null {
  return GROWTH_AREAS.find((a) => a.id === id) ?? null;
}

// ─── Step 1: five free-text reflections, answered by the parent ───────────────
// Ids are area-prefixed and positional, and share no key with the pre-redesign
// question set. A document still holding old answers therefore resolves to
// "nothing answered" and the wizard restarts cleanly at question 1.

export interface Question {
  id: string;
  question: string;
  hint: string;
}

export const AREA_QUESTIONS: Record<string, Question[]> = {
  life_ambition: [
    {
      id: 'la_q1',
      question: 'When {name} talks about what {he} want{s} to be one day, what {does} {he} say?',
      hint: '{His} words, even if they change every month.',
    },
    {
      id: 'la_q2',
      question: 'What {does} {he} do without being asked or reminded?',
      hint: 'The thing {he} return{s} to on {his} own.',
    },
    {
      id: 'la_q3',
      question: 'Which activity makes {him} forget about time completely?',
      hint: 'The last time you had to call {him} twice.',
    },
    {
      id: 'la_q4',
      question: 'Who {does} {he} look up to, and what {does} {he} admire about them?',
      hint: 'A family member, teacher, athlete or character.',
    },
    {
      id: 'la_q5',
      question: 'What is one thing you would like to see {him} try in the next few months?',
      hint: 'Something small and specific.',
    },
  ],
  self_care: [
    {
      id: 'sc_q1',
      question: 'How does {name} usually show you that {he} {is} upset or overwhelmed?',
      hint: 'Words, silence, anger, stomach aches.',
    },
    {
      id: 'sc_q2',
      question: 'What helps {him} settle down again?',
      hint: 'What has actually worked, not what should work.',
    },
    {
      id: 'sc_q3',
      question: 'Which daily routines are a struggle at the moment?',
      hint: 'Waking, homework, screens, bedtime.',
    },
    {
      id: 'sc_q4',
      question: 'Who {does} {he} go to first when something is bothering {him}?',
      hint: 'If it is no one, write that.',
    },
    {
      id: 'sc_q5',
      question: 'What {does} {he} say about {himself} when things go wrong?',
      hint: 'Try to recall {his} exact phrasing.',
    },
  ],
  critical_thinking: [
    {
      id: 'ct_q1',
      question: 'When {name} gets stuck on something hard, what {does} {he} do next?',
      hint: 'Asks, guesses, gives up, tries again.',
    },
    {
      id: 'ct_q2',
      question: 'What kinds of questions {does} {he} ask you most often?',
      hint: 'How things work, why rules exist, what if.',
    },
    {
      id: 'ct_q3',
      question: 'How {does} {he} handle being told {he} {is} wrong?',
      hint: 'Describe a recent example.',
    },
    {
      id: 'ct_q4',
      question: 'Give an example of {him} working something out for {himself}.',
      hint: 'School, a game, a problem at home.',
    },
    {
      id: 'ct_q5',
      question: 'Which decisions do you let {him} make on {his} own right now?',
      hint: 'And which ones feel too early.',
    },
  ],
  creativity: [
    {
      id: 'cr_q1',
      question: 'What does {name} make, build or invent when left to {himself}?',
      hint: 'Drawings, stories, games, contraptions.',
    },
    {
      id: 'cr_q2',
      question: 'What {does} {he} do when {he} say{s} {he} {is} bored?',
      hint: 'What happens in the ten minutes after.',
    },
    {
      id: 'cr_q3',
      question: 'How {does} {he} react when something {he} make{s} does not turn out right?',
      hint: 'Starts over, hides it, gets frustrated.',
    },
    {
      id: 'cr_q4',
      question: 'Which of {his} ideas has surprised you recently?',
      hint: 'Even a small one counts.',
    },
    {
      id: 'cr_q5',
      question: 'What creative materials or space {does} {he} have access to at home?',
      hint: 'And what is missing.',
    },
  ],
  physical_wellness: [
    {
      id: 'pw_q1',
      question: 'How much of {his} day involves active play or sport?',
      hint: 'A rough estimate across a normal week.',
    },
    {
      id: 'pw_q2',
      question: 'Which kinds of physical activity {does} {he} genuinely enjoy?',
      hint: 'Enjoys, not tolerates.',
    },
    {
      id: 'pw_q3',
      question: 'What does {his} sleep look like on a school night?',
      hint: 'Bedtime, how long to fall asleep, waking.',
    },
    {
      id: 'pw_q4',
      question: 'How would you describe {his} eating habits and appetite?',
      hint: 'Include the parts that worry you.',
    },
    {
      id: 'pw_q5',
      question: 'What {does} {he} say about {his} own body or strength?',
      hint: 'Comments about being fast, weak, tall, tired.',
    },
  ],
  social_skills: [
    {
      id: 'ss_q1',
      question:
        'How does {name} behave when {he} join{s} a group of children {he} {does} not know?',
      hint: 'Leads, watches, waits to be invited.',
    },
    {
      id: 'ss_q2',
      question: 'Who are {his} closest friends, and what draws {him} to them?',
      hint: 'Names are not needed, just the pattern.',
    },
    {
      id: 'ss_q3',
      question: 'How {does} {he} handle disagreements with friends or siblings?',
      hint: 'A recent example is best.',
    },
    {
      id: 'ss_q4',
      question: 'When {does} {he} find it hardest to speak up?',
      hint: 'With adults, in class, in large groups.',
    },
    {
      id: 'ss_q5',
      question: 'How {does} {he} respond when someone else is upset?',
      hint: 'Notices, comforts, withdraws, teases.',
    },
  ],
};

// ─── Step 2: six either/or rounds, answered by the child ──────────────────────
// Each option carries a `tag`; the most-frequent tag across the six picks
// selects the archetype in AREA_ARCHETYPES. `star` is the short label shown on
// the constellation. `icon` is an inline SVG path — there are no bitmap assets,
// so this step has no dependency on the S3 asset bucket.
//
// Option copy addresses the child in second person ("Build a robot…"), so it
// carries no name or pronoun tokens.

export interface GameOption {
  id: string;
  text: string;
  tag: string;
  /** short label for the constellation node */
  star: string;
  /** inline SVG path */
  icon: string;
}

export interface GameRound {
  a: GameOption;
  b: GameOption;
}

/**
 * Inline SVG paths for the option tiles, keyed by name.
 *
 * Exported because the generated child rounds select an icon *by key* — the key
 * set is the enum the model is constrained to, and `iconPathFor` resolves the
 * key it returns back to a path. Keeping this as the single source means a new
 * icon becomes available to the model the moment it's added here.
 */
export const ICON_PATHS = {
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5zM19 18v3H6.5',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  chat: 'M20 12a7 7 0 0 1-7 7H9l-4 3 1-4.2A7 7 0 0 1 13 5a7 7 0 0 1 7 7z',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  flag: 'M6 3v18M6 4h11l-2 4 2 4H6',
  glass: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  hand: 'M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 11V4.5a1.5 1.5 0 0 1 3 0V11M15 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6H10a4 4 0 0 1-4-4v-5a1.5 1.5 0 0 1 3 0',
  heart: 'M12 20s-7-4.4-7-9.3A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.7C19 15.6 12 20 12 20z',
  leaf: 'M20 4C11 4 4 9 4 16v4M20 4c0 8-6 12-12 12',
  mic: 'M12 4a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 12 4zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  moon: 'M20 14a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10z',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-2.5-2.5H9M19 16a2.5 2.5 0 1 1-2.5-2.5H19',
  pad: 'M6 8h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3zM7 12h3M8.5 10.5v3M15 11h.01M17 13h.01',
  palette:
    'M12 3a9 9 0 1 0 0 18c1.5 0 1.5-2 3-2h2a4 4 0 0 0 4-4c0-6-4-12-9-12zM8 9h.01M7 13h.01M11 7h.01',
  plate: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM8 12h8',
  rocket: 'M12 3c3 2.5 4.5 6 4.5 9.5L12 17l-4.5-4.5C7.5 9 9 5.5 12 3zM9.5 17 8 21l4-2 4 2-1.5-4',
  run: 'M13.5 4.2a1.4 1.4 0 1 0 .01 0M11 8l-3 3 2 3-1 5M11 8l4 1 1 4M8 11 4 12',
  shield: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3',
  trophy: 'M8 4h8v4a4 4 0 0 1-8 0zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M10 15h4l.5 5h-5z',
  wrench: 'M15 4a4 4 0 0 0 5 5l-9 9a3 3 0 1 1-4-4z',
};

/** Terse alias, purely to keep the AREA_GAMES table below readable. */
const P = ICON_PATHS;

export type IconKey = keyof typeof ICON_PATHS;

/** The icon vocabulary a generated round may choose from. */
export const ICON_KEYS = Object.keys(ICON_PATHS) as IconKey[];

/**
 * Resolve an icon key to its path, falling back to a neutral sparkle.
 * The key comes from a model response, so an unrecognised one is expected
 * occasionally — the icon is decoration, never meaning, so a fallback is the
 * right call rather than rejecting the whole round set over it.
 */
export function iconPathFor(key: unknown): string {
  if (typeof key === 'string' && key in ICON_PATHS) {
    return ICON_PATHS[key as IconKey];
  }
  return ICON_PATHS.spark;
}

export const AREA_GAMES: Record<string, GameRound[]> = {
  life_ambition: [
    {
      a: {
        id: 'la_r1a',
        text: 'Build a robot that does your chores',
        tag: 'maker',
        star: 'Robot',
        icon: P.wrench,
      },
      b: {
        id: 'la_r1b',
        text: 'Write a story your whole school reads',
        tag: 'teller',
        star: 'Story',
        icon: P.book,
      },
    },
    {
      a: {
        id: 'la_r2a',
        text: 'Lead your team to win a tournament',
        tag: 'leader',
        star: 'Trophy',
        icon: P.trophy,
      },
      b: {
        id: 'la_r2b',
        text: 'Discover a creature nobody has seen',
        tag: 'explorer',
        star: 'Creature',
        icon: P.leaf,
      },
    },
    {
      a: {
        id: 'la_r3a',
        text: 'Teach a younger kid something you are great at',
        tag: 'helper',
        star: 'Teach',
        icon: P.hand,
      },
      b: {
        id: 'la_r3b',
        text: 'Fix something everyone said was broken',
        tag: 'maker',
        star: 'Repair',
        icon: P.wrench,
      },
    },
    {
      a: {
        id: 'la_r4a',
        text: 'Travel somewhere no one in your family has been',
        tag: 'explorer',
        star: 'Journey',
        icon: P.globe,
      },
      b: {
        id: 'la_r4b',
        text: 'Make a game a thousand people play',
        tag: 'maker',
        star: 'Game',
        icon: P.pad,
      },
    },
    {
      a: {
        id: 'la_r5a',
        text: 'Speak on a stage to a big crowd',
        tag: 'leader',
        star: 'Stage',
        icon: P.mic,
      },
      b: {
        id: 'la_r5b',
        text: 'Solve a mystery no one could crack',
        tag: 'thinker',
        star: 'Mystery',
        icon: P.glass,
      },
    },
    {
      a: {
        id: 'la_r6a',
        text: 'Start a club and choose what it does',
        tag: 'leader',
        star: 'Club',
        icon: P.flag,
      },
      b: {
        id: 'la_r6b',
        text: 'Help someone who really needs you',
        tag: 'helper',
        star: 'Rescue',
        icon: P.heart,
      },
    },
  ],
  self_care: [
    {
      a: {
        id: 'sc_r1a',
        text: 'Curl up with a book in a quiet room',
        tag: 'rest',
        star: 'Quiet',
        icon: P.book,
      },
      b: {
        id: 'sc_r1b',
        text: 'Go outside and run around',
        tag: 'body',
        star: 'Fresh air',
        icon: P.run,
      },
    },
    {
      a: {
        id: 'sc_r2a',
        text: 'Have the same calm routine every night',
        tag: 'order',
        star: 'Routine',
        icon: P.clock,
      },
      b: {
        id: 'sc_r2b',
        text: 'Do something different every night',
        tag: 'joy',
        star: 'Surprise',
        icon: P.spark,
      },
    },
    {
      a: {
        id: 'sc_r3a',
        text: 'Tell someone when you feel bad',
        tag: 'feelings',
        star: 'Talk',
        icon: P.chat,
      },
      b: {
        id: 'sc_r3b',
        text: 'Have some time completely alone',
        tag: 'rest',
        star: 'Alone',
        icon: P.moon,
      },
    },
    {
      a: {
        id: 'sc_r4a',
        text: 'A long full night of sleep',
        tag: 'rest',
        star: 'Sleep',
        icon: P.moon,
      },
      b: {
        id: 'sc_r4b',
        text: 'A big proper breakfast',
        tag: 'body',
        star: 'Fuel',
        icon: P.plate,
      },
    },
    {
      a: {
        id: 'sc_r5a',
        text: 'Tidy your room so it feels calm',
        tag: 'order',
        star: 'Tidy',
        icon: P.box,
      },
      b: {
        id: 'sc_r5b',
        text: 'Put on music and dance',
        tag: 'joy',
        star: 'Music',
        icon: P.music,
      },
    },
    {
      a: {
        id: 'sc_r6a',
        text: 'Learn to calm yourself by breathing',
        tag: 'feelings',
        star: 'Breathe',
        icon: P.leaf,
      },
      b: {
        id: 'sc_r6b',
        text: 'Keep one hour a day just for fun',
        tag: 'joy',
        star: 'Play',
        icon: P.pad,
      },
    },
  ],
  critical_thinking: [
    {
      a: {
        id: 'ct_r1a',
        text: 'Take a gadget apart to see inside',
        tag: 'curious',
        star: 'Inside',
        icon: P.wrench,
      },
      b: {
        id: 'ct_r1b',
        text: 'Beat a hard puzzle in one go',
        tag: 'logic',
        star: 'Puzzle',
        icon: P.glass,
      },
    },
    {
      a: {
        id: 'ct_r2a',
        text: 'Ask a hundred questions',
        tag: 'curious',
        star: 'Questions',
        icon: P.chat,
      },
      b: {
        id: 'ct_r2b',
        text: 'Check whether something is really true',
        tag: 'evidence',
        star: 'Proof',
        icon: P.shield,
      },
    },
    {
      a: {
        id: 'ct_r3a',
        text: 'Find the one wrong number in a long list',
        tag: 'logic',
        star: 'Spot it',
        icon: P.glass,
      },
      b: {
        id: 'ct_r3b',
        text: 'Invent a new rule for a game',
        tag: 'invent',
        star: 'New rule',
        icon: P.flag,
      },
    },
    {
      a: {
        id: 'ct_r4a',
        text: 'Keep trying one problem for an hour',
        tag: 'patient',
        star: 'Persist',
        icon: P.clock,
      },
      b: {
        id: 'ct_r4b',
        text: 'Try ten problems fast',
        tag: 'logic',
        star: 'Speed',
        icon: P.spark,
      },
    },
    {
      a: {
        id: 'ct_r5a',
        text: 'Win an argument with good reasons',
        tag: 'evidence',
        star: 'Reasons',
        icon: P.mic,
      },
      b: {
        id: 'ct_r5b',
        text: 'Wonder about something nobody can answer',
        tag: 'curious',
        star: 'Wonder',
        icon: P.globe,
      },
    },
    {
      a: {
        id: 'ct_r6a',
        text: 'Make a plan before you start',
        tag: 'patient',
        star: 'Plan',
        icon: P.box,
      },
      b: {
        id: 'ct_r6b',
        text: 'Guess and adjust as you go',
        tag: 'invent',
        star: 'Adapt',
        icon: P.leaf,
      },
    },
  ],
  creativity: [
    {
      a: {
        id: 'cr_r1a',
        text: 'Build something out of spare parts',
        tag: 'make',
        star: 'Build',
        icon: P.wrench,
      },
      b: {
        id: 'cr_r1b',
        text: 'Invent a whole new world',
        tag: 'imagine',
        star: 'World',
        icon: P.globe,
      },
    },
    {
      a: {
        id: 'cr_r2a',
        text: 'Draw a comic',
        tag: 'story',
        star: 'Comic',
        icon: P.book,
      },
      b: {
        id: 'cr_r2b',
        text: 'Make up a song',
        tag: 'perform',
        star: 'Song',
        icon: P.music,
      },
    },
    {
      a: {
        id: 'cr_r3a',
        text: 'Act out a character on stage',
        tag: 'perform',
        star: 'Stage',
        icon: P.mic,
      },
      b: {
        id: 'cr_r3b',
        text: 'Design a game nobody has played',
        tag: 'make',
        star: 'Design',
        icon: P.pad,
      },
    },
    {
      a: {
        id: 'cr_r4a',
        text: 'Mix two ideas nobody has combined',
        tag: 'mix',
        star: 'Mix',
        icon: P.spark,
      },
      b: {
        id: 'cr_r4b',
        text: 'Retell an old story your own way',
        tag: 'story',
        star: 'Retell',
        icon: P.book,
      },
    },
    {
      a: {
        id: 'cr_r5a',
        text: 'Make something beautiful',
        tag: 'imagine',
        star: 'Beauty',
        icon: P.palette,
      },
      b: {
        id: 'cr_r5b',
        text: 'Make something useful',
        tag: 'make',
        star: 'Useful',
        icon: P.box,
      },
    },
    {
      a: {
        id: 'cr_r6a',
        text: 'Show your work to a crowd',
        tag: 'perform',
        star: 'Share',
        icon: P.mic,
      },
      b: {
        id: 'cr_r6b',
        text: 'Keep it just for you',
        tag: 'imagine',
        star: 'Secret',
        icon: P.moon,
      },
    },
  ],
  physical_wellness: [
    {
      a: {
        id: 'pw_r1a',
        text: 'Race someone to the end of the street',
        tag: 'speed',
        star: 'Race',
        icon: P.run,
      },
      b: {
        id: 'pw_r1b',
        text: 'Climb something tall and tricky',
        tag: 'strength',
        star: 'Climb',
        icon: P.flag,
      },
    },
    {
      a: {
        id: 'pw_r2a',
        text: 'Learn a trick that takes a month',
        tag: 'skill',
        star: 'Trick',
        icon: P.clock,
      },
      b: {
        id: 'pw_r2b',
        text: 'Win a game today',
        tag: 'team',
        star: 'Win',
        icon: P.trophy,
      },
    },
    {
      a: {
        id: 'pw_r3a',
        text: 'Play a sport with a team',
        tag: 'team',
        star: 'Team',
        icon: P.hand,
      },
      b: {
        id: 'pw_r3b',
        text: 'Train on your own',
        tag: 'strength',
        star: 'Train',
        icon: P.box,
      },
    },
    {
      a: {
        id: 'pw_r4a',
        text: 'Spend a whole day outside',
        tag: 'outdoors',
        star: 'Outside',
        icon: P.leaf,
      },
      b: {
        id: 'pw_r4b',
        text: 'Master one skateboard move',
        tag: 'skill',
        star: 'Move',
        icon: P.spark,
      },
    },
    {
      a: {
        id: 'pw_r5a',
        text: 'Be the fastest in your class',
        tag: 'speed',
        star: 'Fastest',
        icon: P.run,
      },
      b: {
        id: 'pw_r5b',
        text: 'Be the one who never gets tired',
        tag: 'strength',
        star: 'Stamina',
        icon: P.shield,
      },
    },
    {
      a: {
        id: 'pw_r6a',
        text: 'Hike up a hill for the view',
        tag: 'outdoors',
        star: 'Summit',
        icon: P.globe,
      },
      b: {
        id: 'pw_r6b',
        text: 'Teach a friend your best move',
        tag: 'team',
        star: 'Coach',
        icon: P.mic,
      },
    },
  ],
  social_skills: [
    {
      a: {
        id: 'ss_r1a',
        text: 'Make one new friend today',
        tag: 'friend',
        star: 'New friend',
        icon: P.hand,
      },
      b: {
        id: 'ss_r1b',
        text: 'Cheer up a friend who is sad',
        tag: 'kind',
        star: 'Cheer',
        icon: P.heart,
      },
    },
    {
      a: {
        id: 'ss_r2a',
        text: 'Be captain of the group',
        tag: 'lead',
        star: 'Captain',
        icon: P.flag,
      },
      b: {
        id: 'ss_r2b',
        text: 'Be the one everybody tells secrets to',
        tag: 'listen',
        star: 'Trusted',
        icon: P.chat,
      },
    },
    {
      a: {
        id: 'ss_r3a',
        text: 'Speak first in a room of strangers',
        tag: 'brave',
        star: 'Speak up',
        icon: P.mic,
      },
      b: {
        id: 'ss_r3b',
        text: 'Listen carefully before you talk',
        tag: 'listen',
        star: 'Listen',
        icon: P.chat,
      },
    },
    {
      a: {
        id: 'ss_r4a',
        text: 'Stand up for someone left out',
        tag: 'brave',
        star: 'Stand up',
        icon: P.shield,
      },
      b: {
        id: 'ss_r4b',
        text: 'Invite them into your game',
        tag: 'kind',
        star: 'Invite',
        icon: P.hand,
      },
    },
    {
      a: {
        id: 'ss_r5a',
        text: 'Sort out an argument between friends',
        tag: 'lead',
        star: 'Peace',
        icon: P.trophy,
      },
      b: {
        id: 'ss_r5b',
        text: 'Keep everyone laughing',
        tag: 'friend',
        star: 'Laughs',
        icon: P.spark,
      },
    },
    {
      a: {
        id: 'ss_r6a',
        text: 'Have one best friend',
        tag: 'friend',
        star: 'Best friend',
        icon: P.heart,
      },
      b: {
        id: 'ss_r6b',
        text: 'Know everyone in school',
        tag: 'lead',
        star: 'Everyone',
        icon: P.globe,
      },
    },
  ],
};

// ─── Archetypes ───────────────────────────────────────────────────────────────
// Derived, never stored: recomputed from the saved picks on every render, so
// nothing needs persisting alongside child_activity_selections.

export interface Archetype {
  title: string;
  line: string;
}

export const AREA_ARCHETYPES: Record<string, Record<string, Archetype>> = {
  life_ambition: {
    maker: {
      title: 'The Builder',
      line: '{name} is drawn to making things that work. Give {him} materials, time and a problem worth fixing.',
    },
    teller: {
      title: 'The Storyteller',
      line: '{name} reaches for words and worlds. Audiences, journals and stages will feed this.',
    },
    leader: {
      title: 'The Leader',
      line: '{name} wants a team and a direction. Let {him} run something real, however small.',
    },
    explorer: {
      title: 'The Explorer',
      line: '{name} is pulled towards the unfamiliar. New places and open questions keep {him} alight.',
    },
    thinker: {
      title: 'The Solver',
      line: '{name} likes a puzzle with a locked door. Give {him} harder ones than you think {he} can take.',
    },
    helper: {
      title: 'The Helper',
      line: '{name} measures {himself} by who {he} lift{s}. Responsibility for others will grow {him} fastest.',
    },
  },
  self_care: {
    rest: {
      title: 'The Recharger',
      line: '{name} refills in quiet. Protect {his} downtime instead of filling it.',
    },
    body: {
      title: 'The Body Listener',
      line: '{name} feels things physically first. Food, air and movement change {his} mood fastest.',
    },
    feelings: {
      title: 'The Feeler',
      line: '{name} is ready to name what {he} feel{s}. Keep asking, and keep the answers safe.',
    },
    order: {
      title: 'The Steady One',
      line: '{name} does better with rhythm than with rules. Build the routine with {him}.',
    },
    joy: {
      title: 'The Joy Seeker',
      line: '{name} resets through fun. An hour of nothing useful is doing real work.',
    },
  },
  critical_thinking: {
    curious: {
      title: 'The Question Machine',
      line: '{name} learns by asking. Answer two, then hand the third back to {him}.',
    },
    logic: {
      title: 'The Pattern Finder',
      line: '{name} enjoys order in a mess. Puzzles, codes and strategy games suit {him}.',
    },
    evidence: {
      title: 'The Fact Checker',
      line: '{name} wants to know how you know. Show {him} where to look it up.',
    },
    invent: {
      title: 'The Rule Bender',
      line: '{name} reshapes the problem rather than solving it as given. Leave room for that.',
    },
    patient: {
      title: 'The Long Thinker',
      line: '{name} can stay with something difficult. Resist rescuing {him} too early.',
    },
  },
  creativity: {
    make: {
      title: 'The Maker',
      line: '{name} thinks with {his} hands. Keep raw materials within reach.',
    },
    story: {
      title: 'The Storyteller',
      line: '{name} turns everything into narrative. Give {him} somewhere to publish it.',
    },
    perform: {
      title: 'The Performer',
      line: '{name} needs an audience to come alive. Find {him} a small stage.',
    },
    imagine: {
      title: 'The Dreamer',
      line: '{name} builds whole worlds internally. Unstructured time is not wasted on {him}.',
    },
    mix: {
      title: 'The Remixer',
      line: '{name} collides ideas that do not belong together. Expose {him} to more of them.',
    },
  },
  physical_wellness: {
    speed: {
      title: 'The Sprinter',
      line: '{name} is built for bursts. Short, sharp challenges hold {him}.',
    },
    strength: {
      title: 'The Strong One',
      line: '{name} enjoys the effort itself. Give {him} something heavy and safe to work at.',
    },
    skill: {
      title: 'The Skill Collector',
      line: '{name} will drill one move for weeks. Reward the practice, not just the result.',
    },
    team: {
      title: 'The Teammate',
      line: '{name} moves best beside other people. Team sport beats solo training here.',
    },
    outdoors: {
      title: 'The Outdoor Kid',
      line: '{name} regulates {himself} outside. Long days out do more than any programme.',
    },
  },
  social_skills: {
    friend: {
      title: 'The Friend Maker',
      line: '{name} invests in people one at a time. Depth matters more than numbers.',
    },
    lead: {
      title: 'The Natural Lead',
      line: '{name} organises the room without being asked. Give {him} something to be in charge of.',
    },
    listen: {
      title: 'The Listener',
      line: '{name} holds what others tell {him}. Make sure someone is listening to {him} too.',
    },
    kind: {
      title: 'The Kind One',
      line: '{name} notices who is left out. Name it when you see it.',
    },
    brave: {
      title: 'The Brave Voice',
      line: '{name} will speak when it costs {him} something. Back {him} publicly.',
    },
  },
};

/**
 * The tag vocabulary for an area — the archetype keys, in declaration order.
 * Doubles as the enum a generated round's `tag` is constrained to: a tag outside
 * this set would leave topArchetype with nothing to resolve.
 */
export function tagsForArea(areaId: string): string[] {
  return Object.keys(AREA_ARCHETYPES[areaId] ?? {});
}

/** All options in a round set, flattened — a and b of every round. */
function allOptions(rounds: GameRound[]): GameOption[] {
  return rounds.flatMap((r) => [r.a, r.b]);
}

/** Resolve a saved pick id back to its option. Returns null for unknown ids. */
export function optionById(rounds: GameRound[], optionId: string): GameOption | null {
  return allOptions(rounds).find((o) => o.id === optionId) ?? null;
}

/**
 * Resolve saved picks to options, dropping any that no longer exist.
 * Callers should read a short result as "the child step needs redoing" rather
 * than rendering a partial constellation.
 */
export function pickedOptions(rounds: GameRound[], pickedIds: unknown): GameOption[] {
  if (!Array.isArray(pickedIds)) return [];
  return pickedIds
    .map((id) => (typeof id === 'string' ? optionById(rounds, id) : null))
    .filter((o): o is GameOption => o !== null);
}

/**
 * Pick the round set a saved list of ids should be read against.
 *
 * Three generations of pick ids coexist in the database and none are migrated:
 *   • generated ids (`<area_id>_gr1a`) — everything written since questions
 *     became LLM-generated, resolved against `generated`
 *   • redesign ids (`la_r1a`) — areas completed against the hardcoded AREA_GAMES
 *     table, which is kept precisely so these still resolve to the options the
 *     child actually chose rather than to unrelated generated ones
 *   • pre-redesign image-tile ids — resolve against neither, and correctly read
 *     as "the child step needs redoing"
 *
 * Whichever set the ids actually belong to wins, so no caller has to know which
 * generation a document came from.
 */
export function resolveRounds(
  areaId: string,
  generated: GameRound[] | null | undefined,
  pickedIds: unknown,
): GameRound[] {
  const ids = Array.isArray(pickedIds) ? pickedIds.filter((id) => typeof id === 'string') : [];
  const legacy = AREA_GAMES[areaId] ?? [];
  if (ids.length === 0) return generated ?? legacy;

  const resolvesIn = (rounds: GameRound[]): boolean => {
    if (rounds.length === 0) return false;
    const known = new Set(allOptions(rounds).map((o) => o.id));
    return ids.every((id) => known.has(id));
  };

  if (generated && resolvesIn(generated)) return generated;
  if (resolvesIn(legacy)) return legacy;
  // Neither set owns these ids. Prefer the generated set so a fresh replay is
  // played against this child's own rounds.
  return generated ?? legacy;
}

/**
 * Most-frequent tag across the child's picks → its archetype.
 * A tie resolves to whichever tag first reached the winning count, following
 * the round order the child answered in. Returns null when nothing resolves.
 */
export function topArchetype(
  areaId: string,
  rounds: GameRound[],
  pickedIds: unknown,
): { tag: string; archetype: Archetype } | null {
  const options = pickedOptions(rounds, pickedIds);
  if (options.length === 0) return null;

  const counts = new Map<string, number>();
  for (const o of options) counts.set(o.tag, (counts.get(o.tag) ?? 0) + 1);

  let bestTag = options[0]!.tag;
  let bestCount = -1;
  for (const [tag, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      bestTag = tag;
    }
  }

  const archetype = AREA_ARCHETYPES[areaId]?.[bestTag];
  return archetype ? { tag: bestTag, archetype } : null;
}

// ─── Recommendations ──────────────────────────────────────────────────────────
// Two shapes coexist in the database permanently and neither is migrated:
//   • plain strings — every area completed before the redesign, plus anything
//     the onboarding RecommendationsPhase writes (it still emits strings)
//   • { title, detail } — everything the redesigned Growth Areas flow writes
// Every read path must go through normalizeRecommendations() so both render.

export interface GrowthRecommendation {
  title: string;
  detail: string;
}

const RECOMMENDATION_TITLE_MAX_WORDS = 10;
const RECOMMENDATION_DETAIL_MAX_WORDS = 25;

/**
 * Truncates to at most `maxWords` words, marking the cut with an ellipsis.
 * The prompt already asks the model to stay within budget, and the request
 * schema states the same limit — but nothing here enforces it server-side
 * (the LLM call uses plain JSON mode, not a provider's strict structured
 * output), so this is the actual guarantee, not just a backstop for it.
 */
function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

export function normalizeRecommendations(raw: unknown): GrowthRecommendation[] {
  if (!Array.isArray(raw)) return [];
  const out: GrowthRecommendation[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      // Legacy shape — full-sentence recommendations written before the
      // title/detail split existed, plus anything the onboarding flow still
      // writes. These were never subject to a word budget, so they're left
      // as-is rather than mangled by a cap they weren't authored for.
      const title = item.trim();
      if (title) out.push({ title, detail: '' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    // `t`/`b` is the shorthand the source design used — accepted so a payload
    // authored against that shape is not silently dropped.
    const title = typeof o.title === 'string' ? o.title : typeof o.t === 'string' ? o.t : '';
    const detail = typeof o.detail === 'string' ? o.detail : typeof o.b === 'string' ? o.b : '';
    const trimmedTitle = title.trim();
    const trimmedDetail = detail.trim();
    if (trimmedTitle || trimmedDetail) {
      out.push({
        title: capWords(trimmedTitle, RECOMMENDATION_TITLE_MAX_WORDS),
        detail: capWords(trimmedDetail, RECOMMENDATION_DETAIL_MAX_WORDS),
      });
    }
  }
  return out;
}

/** Flatten recommendations to plain lines, for prompt context. */
export function recommendationsToLines(raw: unknown): string[] {
  return normalizeRecommendations(raw).map((r) =>
    r.detail ? `${r.title} — ${r.detail}` : r.title,
  );
}

// ─── Generated question sets ──────────────────────────────────────────────────
// Both question sets above are the fallback shape only; what a parent actually
// answers is generated per child per area and cached on the child document at
// growth_questions.areas.<area_id>.{parent,child}.
//
// The LLM call runs in plain JSON mode, not a provider's strict structured
// output — the response schema reaches the model as a hint in the system message
// (see backend/app/services/llm_service.py), so its enums and counts are
// advisory. These normalisers are therefore the actual guarantee that what
// reaches the UI is renderable, not a backstop for one.
//
// Returning null means "unusable" and surfaces to the parent as an error with a
// retry, so the bar is deliberately: repair what is cosmetic, reject what would
// silently degrade the result.

const QUESTION_MAX_WORDS = 22;
const HINT_MAX_WORDS = 14;
const OPTION_TEXT_MAX_WORDS = 12;
const STAR_MAX_CHARS = 14;

/** Ids are assigned here, never taken from the model — see idsFor* below. */
function questionId(areaId: string, index: number): string {
  return `${areaId}_gq${index + 1}`;
}

function optionId(areaId: string, roundIndex: number, side: 'a' | 'b'): string {
  return `${areaId}_gr${roundIndex + 1}${side}`;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Unwrap `{ questions: [...] }` / `{ rounds: [...] }`, or a bare array. */
function readArray(raw: unknown, key: string): unknown[] | null {
  if (Array.isArray(raw)) return raw as unknown[];
  if (!raw || typeof raw !== 'object') return null;
  const nested = (raw as Record<string, unknown>)[key];
  return Array.isArray(nested) ? (nested as unknown[]) : null;
}

/**
 * Validate a generated parent reflection set, assigning stable ids.
 *
 * Ids are positional and namespaced per area (`life_ambition_gq1`), sharing no
 * key with the hardcoded `la_q1` set. A document still holding hardcoded answers
 * therefore resolves to "nothing answered" and the wizard restarts cleanly at
 * question one — the same deliberate behaviour the redesign relied on, and far
 * better than reusing the ids and showing an old answer under a new question.
 *
 * Returns null unless every slot carries a question; a short set would strand
 * the parent on a wizard whose progress pips promise more than it has.
 */
export function normalizeGeneratedQuestions(raw: unknown, areaId: string): Question[] | null {
  const items = readArray(raw, 'questions');
  if (!items) return null;

  const out: Question[] = [];
  for (const item of items.slice(0, PARENT_QUESTIONS_PER_AREA)) {
    if (!item || typeof item !== 'object') break;
    const o = item as Record<string, unknown>;
    const question = readString(o.question);
    if (!question) break;
    out.push({
      id: questionId(areaId, out.length),
      question: capWords(question, QUESTION_MAX_WORDS),
      // An absent hint renders as nothing, which is a fine question with no
      // sub-heading — not worth rejecting a set over.
      hint: capWords(readString(o.hint), HINT_MAX_WORDS),
    });
  }

  return out.length === PARENT_QUESTIONS_PER_AREA ? out : null;
}

function readOption(
  raw: unknown,
  areaId: string,
  roundIndex: number,
  side: 'a' | 'b',
  allowedTags: Set<string>,
): GameOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const text = readString(o.text);
  const tag = readString(o.tag);
  // A tag outside the area's set leaves topArchetype with nothing to resolve,
  // which silently guts the result screen — the entire payoff of the child's
  // step. Reject rather than guess a substitute and mis-attribute the child.
  if (!text || !allowedTags.has(tag)) return null;

  const star = readString(o.star) || (text.split(/\s+/)[0] ?? '');
  return {
    id: optionId(areaId, roundIndex, side),
    text: capWords(text, OPTION_TEXT_MAX_WORDS),
    tag,
    star: star.slice(0, STAR_MAX_CHARS),
    icon: iconPathFor(o.icon),
  };
}

/**
 * Validate a generated either/or round set, assigning stable ids.
 *
 * Returns null unless all six rounds are complete and every tag is one this
 * area's archetypes can resolve — the handoff copy promises six choices and the
 * result screen is built on the winning tag, so a partial set is not renderable.
 */
export function normalizeGeneratedRounds(raw: unknown, areaId: string): GameRound[] | null {
  const items = readArray(raw, 'rounds');
  if (!items) return null;

  const allowedTags = new Set(tagsForArea(areaId));
  if (allowedTags.size === 0) return null;

  const out: GameRound[] = [];
  for (const item of items.slice(0, GAME_ROUNDS_PER_AREA)) {
    if (!item || typeof item !== 'object') break;
    const o = item as Record<string, unknown>;
    const a = readOption(o.a, areaId, out.length, 'a', allowedTags);
    const b = readOption(o.b, areaId, out.length, 'b', allowedTags);
    if (!a || !b) break;
    if (import.meta.env.DEV && a.tag === b.tag) {
      // Both sides scoring the same tag makes the round unable to discriminate.
      // The archetype still computes, so this is a quality signal for review
      // rather than grounds for making a parent sit through a retry.
      console.warn(
        `[growthAreaData] ${areaId} generated round ${out.length + 1} has the same tag ` +
          `("${a.tag}") on both options — that round cannot discriminate.`,
      );
    }
    out.push({ a, b });
  }

  return out.length === GAME_ROUNDS_PER_AREA ? out : null;
}
