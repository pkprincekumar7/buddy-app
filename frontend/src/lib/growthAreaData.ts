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

// ─── Step 1: five free-text reflections, answered by the parent ───────────────
// Ids are area-prefixed and positional, and share no key with the pre-redesign
// question set. A document still holding old answers therefore resolves to
// "nothing answered" and the wizard restarts cleanly at question 1.

export interface Question {
  id: string;
  question: string;
  hint: string;
}

// ─── Recommendations ──────────────────────────────────────────────────────────
// Two shapes coexist in the database permanently and neither is migrated:
//   • plain strings — every area completed before the redesign
//   • { title, detail } — everything the redesigned Growth Areas flow writes
// Every read path must go through normalizeRecommendations() so both render.

/** Where a recommendation comes from, shown as its tag on the Growth page: the parent's
 * answers and the child's games together, the games, the answers, or the next step. */
export const RECOMMENDATION_SOURCES = ['both', 'kid', 'you', 'step'] as const;
export type RecommendationSource = (typeof RECOMMENDATION_SOURCES)[number];

export interface GrowthRecommendation {
  title: string;
  detail: string;
  source?: RecommendationSource;
}

function readSource(value: unknown): RecommendationSource | undefined {
  return RECOMMENDATION_SOURCES.find((s) => s === value);
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
    const source = readSource(o.source);
    if (trimmedTitle || trimmedDetail) {
      out.push({
        title: capWords(trimmedTitle, RECOMMENDATION_TITLE_MAX_WORDS),
        detail: capWords(trimmedDetail, RECOMMENDATION_DETAIL_MAX_WORDS),
        ...(source ? { source } : {}),
      });
    }
  }
  return out;
}

// ─── Generated question sets ──────────────────────────────────────────────────
// The question set above is the fallback shape only; what a parent actually
// answers is generated per child per area and cached on the child document at
// growth_questions.areas.<area_id>.{parent,child}.
//
// The LLM call runs in plain JSON mode, not a provider's strict structured
// output — the response schema reaches the model as a hint in the system message
// (see backend/common/generation/llm.py), so its enums and counts are
// advisory. These normalisers are therefore the actual guarantee that what
// reaches the UI is renderable, not a backstop for one.
//
// Returning null means "unusable" and surfaces to the parent as an error with a
// retry, so the bar is deliberately: repair what is cosmetic, reject what would
// silently degrade the result.

const QUESTION_MAX_WORDS = 22;
const HINT_MAX_WORDS = 14;

/** Ids are assigned here, never taken from the model — see idsFor* below. */
function questionId(areaId: string, index: number): string {
  return `${areaId}_gq${index + 1}`;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Unwrap `{ questions: [...] }`, or a bare array. */
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
