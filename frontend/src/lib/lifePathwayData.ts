/**
 * lifePathwayData — geometry, copy and normalisers for the Life Pathway page.
 *
 * Copy is authored with the {name}/{he}/{his}/{s} tokens that fillTemplate()
 * resolves (see growthAreaData). The source design was written entirely in "he",
 * so every sentence carrying a pronoun or an agreement-sensitive verb is
 * tokenised rather than hardcoded.
 */

import { GROWTH_AREAS } from '@/lib/growthAreaData';

// ─── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Node x-positions in the chart's 1000×320 viewBox. Seven entries: index 0 is
 * the curve's origin on the baseline (no node drawn), 1–6 carry the age nodes.
 * The percentages the node/label divs are positioned with are these values
 * expressed against the container width — kept in sync by NODE_LEFT_PCT.
 */
const NODE_X = [40, 208, 376, 544, 680, 816, 940] as const;

/** left offsets (%) for the six age nodes — matches the design's absolute layout. */
export const NODE_LEFT_PCT = [20.8, 37.6, 54.4, 68, 81.6, 94] as const;

/** Years past the child's current age at which each milestone node sits. */
export const AGE_OFFSETS = [1, 2, 3, 5, 8, 10] as const;

/**
 * Keys the generate_life_pathway result is stored under — one per milestone slot.
 *
 * Offsets, deliberately not absolute ages: the app accepts ages 8–30, so an
 * age-keyed contract would need a different schema per child, and any stored blob
 * would stop matching the moment the child had a birthday. Offsets are stable for
 * every child at every age, which makes the response schema fixed and lets the
 * page map content to nodes positionally instead of by string-matching an age.
 */
export const MILESTONE_SLOTS = AGE_OFFSETS.map((o) => `y${String(o)}`);

/** Baseline ("routine life") y-values the gap polygon closes against. */
const BASELINE_Y = 300;

/**
 * Cubic path through the seven y-values, one horizontal control point either
 * side of each midpoint. Ported from the design's curve().
 */
export function curve(ys: readonly number[]): string {
  let d = `M${NODE_X[0]} ${ys[0] ?? BASELINE_Y}`;
  for (let k = 1; k < NODE_X.length; k++) {
    const mid = ((NODE_X[k - 1] ?? 0) + (NODE_X[k] ?? 0)) / 2;
    d += ` C${mid} ${ys[k - 1] ?? BASELINE_Y},${mid} ${ys[k] ?? BASELINE_Y},${NODE_X[k]} ${ys[k] ?? BASELINE_Y}`;
  }
  return d;
}

/** Closes the superpower curve down onto the routine-life baseline. */
export function gapPath(ys: readonly number[]): string {
  return `${curve(ys)} L940 310 L40 ${BASELINE_Y} Z`;
}

/**
 * Fraction of the total climb completed at each node.
 *
 * Taken from the design's hand-authored Life Ambition curve
 * (ys = 300,258,208,150,96,44,16) normalised against its own span, rather than
 * fitted to a power curve — no single exponent reproduces it (it eases in for
 * the first two years then accelerates), and an approximation pushed the line
 * far enough off that it collided with the "The gap" caption. Scaling this
 * profile means a fully-completed area redraws the design's curve exactly while
 * a sparser area traces the same shape to a lower ceiling.
 */
const CLIMB = [0, 0.148, 0.324, 0.528, 0.718, 0.901, 1] as const;

/**
 * Per-area trajectory. Lower y = higher on the chart, so the curve climbs from
 * the baseline to a ceiling set by how much the parent actually told us about
 * this area — the same signal the previous chart used for its per-area boost
 * (answer count, plus a bump once recommendations exist). A parent who answered
 * nothing still gets a rising curve; one who completed the area gets a steeper
 * one that finishes near the top.
 */
export function deriveAreaYs(area: {
  answers?: Record<string, unknown> | null;
  recommendations?: unknown;
  ai_three_month_recommendations?: unknown;
}): number[] {
  const answered = Object.values(area.answers ?? {}).filter(Boolean).length;
  const aiRecs = area.ai_three_month_recommendations;
  const recs = Array.isArray(aiRecs) && aiRecs.length > 0 ? aiRecs : area.recommendations;
  const hasRecs = Array.isArray(recs) && recs.length > 0;

  // Ceiling: y=44 with nothing captured, down to y=16 fully completed —
  // matching the design's most-developed area (Life Ambition ends at 16).
  const ceiling = Math.max(16, 44 - answered * 4 - (hasRecs ? 8 : 0));
  const span = BASELINE_Y - ceiling;
  return CLIMB.map((p) => Math.round(BASELINE_Y - span * p));
}

/** Neutral curve shown when no growth area has been completed yet. */
export const NEUTRAL_YS = deriveAreaYs({});

/** Neutral hue (the app's cyan) for the no-areas-completed state. */
export const NEUTRAL_HUE = '75,233,255';

/**
 * "r,g,b" → "#rrggbb". GROWTH_AREAS[].hue is the single source of truth for
 * area colour; the design's own hex palette is the same six triples converted,
 * so deriving avoids a second copy that could drift.
 */
function hueToHex(hue: string): string {
  const parts = hue.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '#4be9ff';
  return `#${parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

/** area_id → hex, derived from the canonical hue triples. */
export const AREA_HEX: Record<string, string> = Object.fromEntries(
  GROWTH_AREAS.map((a) => [a.id, hueToHex(a.hue)]),
);

// ─── Superpower framing per archetype ─────────────────────────────────────────

/**
 * One archetype → one superpower name plus the quality noun the 90-day copy
 * refers back to. Keys match personalityTypes in PersonalityAnalysis.tsx.
 * `lead` is only used when the personality view model carries no description of
 * its own — the generated one is more specific, so it wins where present.
 */
export const ARCHETYPE_SUPERPOWER: Record<
  string,
  { title: string; quality: string; lead: string }
> = {
  Thinker: {
    title: 'Depth on demand',
    quality: 'depth',
    lead: '{He} can hold one hard thing in {his} head far longer than {his} age suggests.',
  },
  Ambitious: {
    title: 'Aim that holds',
    quality: 'drive',
    lead: '{He} set{s} a target and keeps it in view long after most children his age have moved on.',
  },
  Determined: {
    title: 'Finishes what starts',
    quality: 'persistence',
    lead: '{He} keep{s} going at the point where the task stops being fun and starts being work.',
  },
  Outgoing: {
    title: 'The room warms up',
    quality: 'warmth',
    lead: '{He} change{s} the temperature of a room by walking into it, and people remember {him}.',
  },
  Creative: {
    title: 'Ideas on tap',
    quality: 'invention',
    lead: '{He} produce{s} new ideas faster than {he} can use them, from almost any starting point.',
  },
  Enthusiastic: {
    title: 'Energy that spreads',
    quality: 'enthusiasm',
    lead: '{His} excitement is contagious — {he} pull{s} other people into whatever {he} {has} started.',
  },
  Restless: {
    title: 'Motion into progress',
    quality: 'momentum',
    lead: '{He} {is} already moving while others are still deciding, and {he} learn{s} fast by doing.',
  },
  'Highly Energetic': {
    title: 'Stamina to spare',
    quality: 'stamina',
    lead: '{He} can go at something long past the point where most children his age run out.',
  },
  Playful: {
    title: 'Lightness under pressure',
    quality: 'lightness',
    lead: '{He} keep{s} things light when they get tense, and that makes hard things approachable.',
  },
};

export const DEFAULT_SUPERPOWER = ARCHETYPE_SUPERPOWER['Creative']!;

// ─── Static page copy ─────────────────────────────────────────────────────────

export const COPY = {
  intro:
    'Personality transformation of children and individuals to their best or superpower versions & maintaining the same at most times.',
  headlineA: 'Become {his} best version.',
  headlineB: 'And stay there for life.',
  superpowerLabel: '{His} superpower',
  superpowerTail:
    'Superpower builds the whole ten years around that strength, weekly, until {his} best version stops being a good day and becomes who {he} {is}.',
  firstTenTitle: 'First 10',
  chartTitle: 'The Superpower life',
  chartSub: 'Tap any age to see what changes that year',
  growthAreaLabel: 'Growth area',
  legendSuperpower: 'Superpower',
  legendRoutine: 'Routine life',
  gapTitle: 'The gap',
  gapSub: 'everything {he} never got exposed to',
  msSuperpowerLabel: 'Superpower version',
  msRoutineLabel: 'Routine life',
  compareSuperTitle: 'The Superpower version',
  compareSuperLead: '{He} live{s} as {his} best self, in every area, most of the time.',
  compareSuperBody:
    'Success across work, health, thinking and people at once — because being at {his} best became the habit, not the exception.',
  compareRoutineTitle: 'The routine version',
  compareRoutineLead: 'Just as able. At {his} best only now and then.',
  compareRoutineBody:
    'Success in whichever area the world happened to ask for — {his} best self shows up by luck rather than by habit.',
  ninetyTitle: 'The first 90 days',
  ctaHeadlineA: 'Ninety days to start becoming {his} superpower version.',
  ctaHeadlineB: 'Superpower keeps {him} there, for life.',
} as const;

/** Day 0/30/60/90 markers — x positions are the design's. */
export const TIMELINE = [
  { x: 40, r: 6, fill: '#4be9ff', label: 'Day 0 · start', anchor: 'start', color: '#7f97a8' },
  {
    x: 347,
    r: 6,
    fill: '#8fd8e8',
    label: 'Day 30 · no reminders',
    anchor: 'middle',
    color: '#7f97a8',
  },
  {
    x: 653,
    r: 6,
    fill: '#d3cba8',
    label: 'Day 60 · {his} own idea',
    anchor: 'middle',
    color: '#9fb4c2',
  },
  {
    x: 960,
    r: 7,
    fill: '#ffd89a',
    label: 'Day 90 · second nature',
    anchor: 'end',
    color: '#f0c98a',
  },
] as const;

export const MONTHS = [
  {
    tab: 'Month 1 · Anchor',
    days: 'Days 1–30',
    title: 'Anchor the day',
    sub: 'Small enough that {he} never miss{es}. Nothing new to buy or join.',
    end: 'By day 30 · the routine runs without you reminding {him}.',
  },
  {
    tab: 'Month 2 · Stretch',
    days: 'Days 31–60',
    title: 'Stretch the edges',
    // {quality} is substituted from ARCHETYPE_SUPERPOWER before fillTemplate runs.
    sub: 'Same habits, harder ask. {His} {quality} now meets other people.',
    end: 'By day 60 · {he} propose{s} things before you do.',
  },
  {
    tab: 'Month 3 · Own it',
    days: 'Days 61–90',
    title: 'Hand it over',
    sub: '{He} run{s} it. You watch and log. This is where it becomes {his}.',
    end: 'By day 90 · {his} best version is the normal one. Quarter two builds on it.',
  },
] as const;

/**
 * Generic 90-day moves, used for an area that has no stored recommendation for
 * a given month. Indexed [monthIndex][area_id] so a partially-generated child
 * still fills every row rather than showing gaps.
 */
export const FALLBACK_MONTH_MOVES: Record<string, readonly [string, string, string]> = {
  life_ambition: [
    'one project with a date and one viewer.',
    'second project, twice the scope, real deadline.',
    '{he} pick{s} project three and sets its own deadline.',
  ],
  self_care: [
    'fixed lights-out, phone out of the room.',
    '{he} name{s} the reset that works when {he} {is} flat.',
    'sleep and screens run on rules {he} wrote.',
  ],
  critical_thinking: [
    'answer two questions, hand the third back.',
    'one weekly debate where {he} bring{s} the evidence.',
    '{he} say{s} out loud where {he} changed {his} mind.',
  ],
  creativity: [
    'ten quiet minutes daily, no screen, {his} choice.',
    '{he} show{s} one finished piece to someone outside home.',
    'three finished pieces, and a favourite {he} can defend.',
  ],
  physical_wellness: [
    '20 minutes outdoors after school, every day.',
    'one sport {he} picked, twice a week, tracked.',
    'movement survives a bad week without a reminder.',
  ],
  social_skills: [
    '{he} orders, asks, pays — one small thing a week.',
    'one outing {he} plans: route, budget, timing.',
    '{he} lead{s} one thing with other children in it.',
  ],
};

// ─── Milestone fallback copy ──────────────────────────────────────────────────

/** The four authored/generated fields of a milestone. Carries no age: which year
 *  a milestone belongs to is decided by its slot, never by its content. */
export interface MilestoneCopy {
  title: string;
  /** what the Superpower path looks like that year */
  guided: string;
  /** what Superpower specifically does to get there */
  power: string;
  /** what happens on the routine path instead */
  drift: string;
}

/** A milestone bound to a concrete year, ready to render. */
export interface Milestone extends MilestoneCopy {
  age: string;
}

/**
 * The design's own milestone copy, kept as the fallback so the page is complete
 * and on-message the instant it renders — the per-area LLM job then replaces it
 * with something specific to this child. Six entries per area, aligned to
 * AGE_OFFSETS.
 */
export const FALLBACK_MILESTONES: Record<string, readonly MilestoneCopy[]> = {
  life_ambition: [
    {
      title: '{He} finish{es} something for the first time',
      guided:
        'One project with a deadline and an audience, seen all the way through. {He} discover{s} that finishing feels nothing like starting.',
      power:
        'Superpower turns your five answers into one build {he} can actually complete this month.',
      drift: 'Ten things started, none finished. {His} intensity gets filed away as a phase.',
    },
    {
      title: '{He} teach{es} what {he} know{s}',
      guided:
        '{He} coach{es} a younger child or runs a small club. Saying it out loud converts a talent into a skill {he} can repeat.',
      power:
        'Weekly prompts push {him} from consuming to explaining, the fastest known way to lock learning in.',
      drift: 'What {he} know{s} stays private. {His} confidence rises and falls with {his} marks.',
    },
    {
      title: '{He} go{es} deep by choice',
      guided:
        'One subject pursued far past the syllabus because {he} want{s} to. The first thing that is unmistakably {his}.',
      power:
        'The profile spots what {he} keep{s} returning to and tells you exactly where to add fuel.',
      drift: 'Effort spreads thin across whatever gets assessed next. Nothing compounds.',
    },
    {
      title: '{He} run{s} something real',
      guided:
        '{He} lead{s} a team with a visible outcome and debriefs it honestly. Responsibility stops being theoretical.',
      power:
        'Superpower hands {him} progressively bigger ownership instead of waiting for school to offer it.',
      drift: 'Capable but unproven. {He} wait{s} to be picked, and mostly {is} not.',
    },
    {
      title: '{He} {has} a body of work',
      guided:
        'A portfolio that speaks for {him} alongside the grades. Doors open on the strength of what {he} made.',
      power:
        'Eight years of finished projects, logged and visible, because each one was tracked from the start.',
      drift: 'Grades only. Choices made by cut-off marks rather than by fit.',
    },
    {
      title: '{He} choose{s} {his} own direction',
      guided:
        'Work that matches how {he} actually think{s}, entered with momentum and evidence rather than hope.',
      power: 'A decade of data on what energises {him} makes the decision obvious, not agonising.',
      drift: 'The safe default, quietly reopened in {his} late twenties.',
    },
  ],
  self_care: [
    {
      title: '{He} notice{s} {his} own signals',
      guided: '{He} name{s} tiredness, hunger and overwhelm before they take over the evening.',
      power: 'A two-line daily check-in turns a mood into something {he} can point at.',
      drift: 'Moods arrive unexplained and bad evenings get blamed on behaviour.',
    },
    {
      title: '{He} own{s} {his} routine',
      guided:
        'Sleep, food and screen limits run on rules {he} helped set, so {he} defend{s} them {himself}.',
      power: 'Superpower turns household rules into agreements {he} sign{s}.',
      drift: 'Routine is enforced from outside and renegotiated every night.',
    },
    {
      title: '{He} {has} a way down',
      guided:
        'One reliable way to settle {himself} — walk, breath, music, notebook — used without prompting.',
      power: 'The profile tests which reset actually works for {him} instead of guessing.',
      drift: 'The only reset is a screen, and recovery takes the whole evening.',
    },
    {
      title: '{He} ask{s} for help early',
      guided:
        '{He} say{s} the difficult thing while it is still small, to you or one trusted adult.',
      power:
        'Weekly prompts keep a low-stakes channel open, so hard news is never the first thing on it.',
      drift: 'Problems surface late, usually through marks or a call from school.',
    },
    {
      title: '{He} carr{ies} {himself}',
      guided: 'Sleep, food and stress managed away from home without falling apart.',
      power: 'Eight years of small habits make independence practised rather than sudden.',
      drift: 'The first year away resets every habit at once.',
    },
    {
      title: '{He} {is} steady under load',
      guided: 'Deadlines and setbacks land, and {he} recover{s} in days rather than months.',
      power: 'A decade of tracked recovery shows {him} exactly what {he} need{s}.',
      drift: '{He} push{es} through until something gives.',
    },
  ],
  critical_thinking: [
    {
      title: '{He} ask{s} the better question',
      guided: '{He} learn{s} to ask what would change {his} mind, not just what the answer is.',
      power: 'Superpower gives you one question a week that has no easy answer.',
      drift: '{He} answer{s} what is asked and stops there.',
    },
    {
      title: '{He} argue{s} with evidence',
      guided: 'Family debates where {he} {has} to bring a reason, not a volume.',
      power: 'Prompts turn dinner arguments into practice with a scorecard.',
      drift: 'Opinions get louder rather than better supported.',
    },
    {
      title: '{He} change{s} {his} mind on purpose',
      guided: '{He} state{s} a position, tests it, and says out loud where {he} was wrong.',
      power: 'The profile logs the reversals, so {he} see{s} that changing {his} mind is a skill.',
      drift: 'Being wrong feels like losing, so {he} defend{s} everything.',
    },
    {
      title: '{He} break{s} a big problem down',
      guided: 'One messy real problem, split into parts, with a plan for each.',
      power:
        'Superpower hands {him} progressively harder problems instead of waiting for exams to.',
      drift: 'Big problems stay big and get avoided.',
    },
    {
      title: '{He} reason{s} in public',
      guided: '{He} can hold a line in front of a room and update it without embarrassment.',
      power: 'Years of logged arguments give {him} evidence that {his} thinking holds up.',
      drift: 'Sharp in private, silent in the room that counts.',
    },
    {
      title: '{He} decide{s} well under uncertainty',
      guided: 'Chooses with incomplete information, then reviews the call honestly.',
      power: 'A decade of tracked decisions gives {him} a record instead of a hunch.',
      drift: 'Decisions get postponed until someone else makes them.',
    },
  ],
  creativity: [
    {
      title: '{He} make{s} something nobody asked for',
      guided: 'One thing built purely because {he} wanted it to exist.',
      power: 'Superpower keeps a running list of what {he} actually want{s} to make.',
      drift: 'Making things happens only when a teacher sets it.',
    },
    {
      title: '{He} show{s} the work',
      guided: 'An audience, however small. Work changes the moment someone else sees it.',
      power: 'Prompts give every project a date and a viewer.',
      drift: 'Everything stays in the drawer, unfinished.',
    },
    {
      title: '{He} develop{s} a style',
      guided: 'Repeated choices start to look like a signature rather than an accident.',
      power: 'The profile spots what {he} keep{s} returning to and tells you where to add fuel.',
      drift: '{He} cop{ies} whatever is in front of {him} that month.',
    },
    {
      title: '{He} work{s} to a brief',
      guided: 'Someone else’s constraint, {his} solution, delivered on time.',
      power: 'Superpower supplies real briefs so creativity meets a deadline.',
      drift: 'Only makes things when the mood arrives.',
    },
    {
      title: '{He} {has} a portfolio with a voice',
      guided: 'A body of work that says something specific about how {he} see{s}.',
      power: 'Eight years of finished pieces, logged and visible from the start.',
      drift: 'Talent with nothing to show for it.',
    },
    {
      title: '{He} make{s} original work',
      guided: 'Work people seek out because it could only have come from {him}.',
      power: 'A decade of data on what energises {him} keeps the output {his} own.',
      drift: 'Creative instinct becomes a hobby {he} mean{s} to get back to.',
    },
  ],
  physical_wellness: [
    {
      title: '{He} move{s} every day by default',
      guided: 'Movement stops being an event and becomes what happens after school.',
      power: 'Superpower sets a daily floor small enough that {he} never miss{es} it.',
      drift: 'Activity depends on whether someone organises it.',
    },
    {
      title: '{He} find{s} {his} sport',
      guided: 'One physical thing {he} choose{s} {himself} and looks forward to.',
      power: 'The profile matches {his} temperament to the kind of sport that suits it.',
      drift: '{He} tr{ies} the popular one, {is} average at it, and stops.',
    },
    {
      title: '{He} train{s}, not just play{s}',
      guided: '{He} understand{s} progress: repetition, rest, and a number that moves.',
      power: 'Weekly logging makes improvement visible enough to be motivating.',
      drift: 'Effort without structure, so nothing visibly improves.',
    },
    {
      title: '{He} fuel{s} and rest{s} on purpose',
      guided: 'Food and sleep treated as part of performance rather than nagging.',
      power: 'Superpower ties habits to the outcomes {he} already care{s} about.',
      drift: 'Late nights and skipped meals, then wonders why {he} {is} flat.',
    },
    {
      title: '{He} keep{s} it without being told',
      guided: 'Training survives exams, holidays and a change of city.',
      power: 'Eight years of unbroken habit make it {his}, not yours.',
      drift: 'Fitness ends the week school does.',
    },
    {
      title: 'Fitness is part of who {he} {is}',
      guided: 'Strong, energetic, and unbothered by a busy month.',
      power: 'A decade of tracked habits means health is maintenance, not a project.',
      drift: 'A gym membership and a plan for January.',
    },
  ],
  social_skills: [
    {
      title: '{He} start{s} the conversation',
      guided: '{He} learn{s} to open with a stranger {his} age instead of waiting to be included.',
      power: 'Superpower gives {him} one small social move a week, sized to {his} comfort.',
      drift: '{He} wait{s} to be approached and {is} often not.',
    },
    {
      title: '{He} repair{s} a friendship',
      guided: 'One fallout handled directly, with an apology or a hard sentence said.',
      power: 'Prompts walk {him} through the conversation before {he} {has} to have it.',
      drift: 'Friendships end quietly and are never mentioned again.',
    },
    {
      title: '{He} find{s} {his} people',
      guided: 'A group formed around what {he} actually like{s} rather than proximity.',
      power: 'The profile points {him} at the rooms where {his} interests already live.',
      drift: '{He} fit{s} in with whoever is nearest and dims {himself} to do it.',
    },
    {
      title: '{He} speak{s} for a group',
      guided: '{He} represent{s} other people — a team, a class, a cause — and {is} trusted to.',
      power: 'Superpower hands {him} visible roles instead of waiting for school to offer one.',
      drift: 'Well liked, never chosen to speak.',
    },
    {
      title: '{He} build{s} a real network',
      guided: 'Adults outside the family who know {his} work and take {his} call.',
      power: 'Years of logged projects give {him} something to reach out about.',
      drift: 'Knows people {his} own age only.',
    },
    {
      title: '{He} {is} the one people call',
      guided: 'Trusted in a crisis and in a celebration, by people who chose {him}.',
      power: 'A decade of practised repair and initiative, not luck.',
      drift: 'Friendly with many, close to almost nobody.',
    },
  ],
};

/** Used when no growth area has been completed, so no area-specific set applies. */
export const CORE_MILESTONES: readonly MilestoneCopy[] = [
  {
    title: '{He} {has} a profile that fits {him}',
    guided:
      'The first picture of how {he} actually thinks, built from what you already know about {him}.',
    power: 'Superpower turns that picture into one small move a week, sized to {him}.',
    drift: 'General advice aimed at the average child, which {he} {is} not.',
  },
  {
    title: '{His} strengths get named',
    guided: 'What {he} {is} naturally good at stops being a family anecdote and becomes a plan.',
    power: 'The profile keeps score of what works so the plan sharpens each month.',
    drift: '{His} strengths stay invisible until someone else happens to spot them.',
  },
  {
    title: 'Weekly becomes normal',
    guided: 'One move a week, done often enough that nobody has to remember it any more.',
    power: 'Prompts arrive whether or not the week went well, which is the point.',
    drift: 'Good intentions in January, forgotten by March.',
  },
  {
    title: 'Several areas move at once',
    guided: 'Thinking, body, people and ambition all get attention in the same quarter.',
    power: 'Superpower balances the areas so one strength does not crowd out the rest.',
    drift: 'Whichever area school graded most recently gets all the attention.',
  },
  {
    title: 'Character holds under pressure',
    guided: 'The habits survive a bad term, a new school, a hard year.',
    power: 'Years of logged recovery show {him} what {he} need{s} when it gets hard.',
    drift: 'Habits hold while things are calm and go first when they are not.',
  },
  {
    title: '{He} choose{s} {his} own direction',
    guided: 'A decision made on evidence about {himself}, entered with momentum.',
    power: 'A decade of data on what energises {him} makes the choice obvious.',
    drift: 'The safe default, quietly reopened later.',
  },
];

// ─── LLM response normalisation ───────────────────────────────────────────────

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Reads one milestone object, or null if it is too incomplete to render. */
function readMilestone(item: unknown): MilestoneCopy | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const title = str(o['title'], 90);
  const guided = str(o['guided'], 320);
  const drift = str(o['drift'], 240);
  // power is the one optional field — the card still reads correctly without its
  // dashed footer, so a missing value is not grounds to reject the milestone.
  if (!title || !guided || !drift) return null;
  return { title, guided, power: str(o['power'], 240), drift };
}

/**
 * Defensive parse of a generate_life_pathway result, aligned to the slot order.
 *
 * The worker writes the raw provider response straight to the domain document, so
 * nothing upstream guarantees the shape — a partial or malformed payload must
 * degrade rather than render blank cards or throw. Returns one entry per slot,
 * null where that slot had nothing usable, or null overall when the whole payload
 * is unreadable (which the caller treats as "not cached", so it regenerates).
 *
 * Two shapes are accepted:
 *   • current — an object keyed by MILESTONE_SLOTS (y1…y10), mapped positionally.
 *   • legacy  — { milestones: [...] } from before slot keys existed, matched by
 *     the age each entry claims. Kept so documents written by the earlier shape
 *     keep rendering instead of silently costing a regeneration.
 */
export function normalizeLifePathwayArea(
  raw: unknown,
  ages: readonly number[],
): (MilestoneCopy | null)[] | null {
  const root = raw as Record<string, unknown> | null | undefined;
  if (!root || typeof root !== 'object') return null;

  const legacy = root['milestones'];
  if (Array.isArray(legacy)) {
    const byAge = new Map<string, MilestoneCopy>();
    for (const item of legacy) {
      const m = readMilestone(item);
      const age = str((item as Record<string, unknown> | null)?.['age'], 4);
      if (m && age && !byAge.has(age)) byAge.set(age, m);
    }
    if (byAge.size === 0) return null;
    return ages.map((age) => byAge.get(String(age)) ?? null);
  }

  const found = collectSlots(root);
  return found.size > 0 ? MILESTONE_SLOTS.map((slot) => found.get(slot) ?? null) : null;
}

/** Depth ceiling for the descent below — one level per slot, plus a little slack. */
const MAX_SLOT_DEPTH = MILESTONE_SLOTS.length + 2;

/**
 * Gathers slot objects wherever they sit in the payload.
 *
 * Normally they are siblings at the root, but a provider has been observed
 * nesting each slot inside the previous one — y2 inside y1, y3 inside y2, six
 * deep — which leaves only y1 reachable at the top level and would strand five
 * perfectly good milestones behind a fallback. Since the worker stores the raw
 * response verbatim, recovering here also repairs documents already written that
 * way, with no migration.
 *
 * First occurrence of a slot wins, so a well-formed payload is unaffected. The
 * depth ceiling stops a pathologically deep object (the response is model-authored
 * and only size-capped upstream) from driving unbounded recursion.
 */
function collectSlots(root: Record<string, unknown>): Map<string, MilestoneCopy> {
  const found = new Map<string, MilestoneCopy>();
  const walk = (node: Record<string, unknown>, depth: number): void => {
    if (depth > MAX_SLOT_DEPTH) return;
    for (const slot of MILESTONE_SLOTS) {
      const child = node[slot];
      if (!child || typeof child !== 'object') continue;
      if (!found.has(slot)) {
        const m = readMilestone(child);
        if (m) found.set(slot, m);
      }
      // Descend regardless of whether this level parsed — the nested variant
      // carries the remaining slots inside it either way.
      walk(child as Record<string, unknown>, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/**
 * Builds the milestones the chart renders — one per age, always.
 *
 * Positional: slot i is age i, so nothing has to be matched by string and a
 * missing slot can only ever affect its own node. `age` is set from the child's
 * real age here and nowhere else, which is why neither the fallback copy nor the
 * model output carries one.
 */
export function mergeMilestones(
  generated: readonly (MilestoneCopy | null)[] | null,
  fallback: readonly MilestoneCopy[],
  ages: readonly number[],
): Milestone[] {
  return ages.map((age, i) => {
    const copy = generated?.[i] ?? fallback[i] ?? fallback[fallback.length - 1];
    return { ...(copy as MilestoneCopy), age: String(age) };
  });
}
