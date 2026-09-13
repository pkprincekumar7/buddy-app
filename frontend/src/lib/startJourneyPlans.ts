/**
 * Content library for the StartJourneyModal's Dashboard (step 4) and Tracker
 * (step 5) — ported from the reference design's own hand-authored `INTERESTS`/
 * `PLANS`/`TRACK` data. Genericized throughout: every "he"/"his"/"him" in the
 * source design is replaced with the same `{he}`/`{his}`/`{him}`/`{s}`-style
 * tokens `fillTemplate` (in `@/lib/growthAreaData`) already resolves elsewhere
 * in this app, including third-person-singular verb agreement (`{he} train{s}`
 * → "he trains" / "they train"). No network calls anywhere in this module —
 * it is pure static content, matching the rest of this feature.
 *
 * `TRACK` is a single fixed 9-step sequence, not one per interest — this
 * matches the reference design's own behavior, where the tracker doesn't
 * actually vary by which interest was picked either.
 */

export type PlanFieldKind = 'text' | 'area' | 'date' | 'count' | 'num' | 'photo';

export interface PlanField {
  k: string;
  kind: PlanFieldKind;
  label: string;
  ph?: string;
  target?: number;
  stepBy?: number;
}

export interface PlanActivity {
  n: string;
  time: string;
  title: string;
  award: string;
  objective: string;
  apply: string;
  do: PlanField[];
}

export interface Plan {
  metric: string;
  goals: string[];
  acts: PlanActivity[];
}

export interface Interest {
  key: string;
  match: string[];
  label: string;
  thing: string;
  plural: string;
  maker: string;
  place: string;
  ev: string[];
  win: string;
  won: string;
}

export type TrackFieldType = 'text' | 'date' | 'note';

export interface TrackField {
  k: string;
  label: string;
  ph?: string;
  type: TrackFieldType;
}

export interface TrackPhotoImport {
  key: string;
  label: string;
  hint: string;
}

export interface TrackStep {
  title: string;
  short: string;
  when: string;
  body: string;
  /** SVG path data for this step's icon (multiple <path> elements). */
  paths: string[];
  fields: TrackField[];
  /** Only the "Make the final piece" step: a 4-week sitting-by-sitting toggle grid. */
  sittings?: boolean;
  up?: TrackPhotoImport;
}

export const INTERESTS: Interest[] = [
  {
    key: 'building',
    match: [
      'building',
      'build',
      'lego',
      'making',
      'tinker',
      'taking things apart',
      'machines',
      'robot',
    ],
    label: 'building things',
    thing: 'a build',
    plural: 'builds',
    maker: 'builder',
    place: 'a local repair shop or maker space',
    ev: ['School science exhibition', 'Local maker fair'],
    win: 'built two working projects on {his} own, start to finish, and given one of them to someone who wanted it',
    won: 'Two working projects built alone, one given away',
  },
  {
    key: 'drawing',
    match: ['drawing', 'draw', 'art', 'sketch', 'paint', 'comic'],
    label: 'drawing',
    thing: 'a drawing',
    plural: 'drawings',
    maker: 'artist',
    place: 'a neighbourhood notice board or school corridor',
    ev: ['School art exhibition', 'Community mural day'],
    win: 'completed twelve finished drawings and had three of them displayed publicly at school or in the neighbourhood',
    won: 'Twelve finished drawings, three shown in public',
  },
  {
    key: 'football',
    match: ['football', 'sport', 'cricket', 'running', 'basketball', 'swim'],
    label: 'football',
    thing: 'a drill',
    plural: 'sessions',
    maker: 'player',
    place: 'the local ground on a Saturday',
    ev: ['School-level football competition', 'Inter-school district trials'],
    win: 'completed sixty training sessions, improved one measurable skill {he} can show you the numbers for, and played a competitive match for a team',
    won: 'Regular training sessions, one skill measurably better, one competitive match played',
  },
  {
    key: 'animals',
    match: ['animal', 'dog', 'cat', 'bird', 'nature', 'insect'],
    label: 'animals',
    thing: 'an observation log',
    plural: 'logs',
    maker: 'naturalist',
    place: 'a shelter, vet or park warden',
    ev: ['School nature project showcase', 'Shelter volunteer day'],
    win: 'recorded thirty animal observations in {his} own log and completed two volunteer shifts at a shelter, vet clinic or park',
    won: 'Thirty observations logged, two volunteer shifts done',
  },
  {
    key: 'space',
    match: ['space', 'star', 'planet', 'astronom', 'rocket'],
    label: 'space',
    thing: 'a sky log',
    plural: 'sky logs',
    maker: 'observer',
    place: 'an astronomy club night',
    ev: ['School astronomy night', 'Regional science fair'],
    win: 'recorded twenty of {his} own night-sky observations and presented them to an astronomy club or {his} class',
    won: 'Twenty night-sky observations, presented to a real audience',
  },
  {
    key: 'music',
    match: ['music', 'sing', 'guitar', 'piano', 'drum', 'song'],
    label: 'music',
    thing: 'a piece',
    plural: 'pieces',
    maker: 'musician',
    place: 'a family gathering or school assembly',
    ev: ['School annual day performance', 'Local youth open mic'],
    win: 'learned two pieces well enough to perform them from memory in front of an audience outside the family',
    won: 'Two pieces learned, both performed from memory',
  },
  {
    key: 'reading',
    match: ['reading', 'read', 'book', 'story', 'writing', 'write'],
    label: 'reading',
    thing: 'a review',
    plural: 'reviews',
    maker: 'reader',
    place: 'the local library noticeboard',
    ev: ['Inter-school debate', 'Library storytelling session'],
    win: 'finished twelve books, written a short review of each, and spoken about one of them in front of an audience',
    won: 'Twelve books finished, twelve reviews written, one talk given',
  },
  {
    key: 'cooking',
    match: ['cook', 'baking', 'bake', 'food', 'kitchen'],
    label: 'cooking',
    thing: 'a dish',
    plural: 'dishes',
    maker: 'cook',
    place: 'a family dinner {he} run{s} end to end',
    ev: ['School food fest stall', 'Family dinner {he} cook{s} alone'],
    win: 'cooked four dishes without help and planned, shopped for and served a full meal to guests',
    won: 'Four dishes cooked alone, one full meal served to guests',
  },
  {
    key: 'gaming',
    match: ['gaming', 'game', 'minecraft', 'roblox', 'console'],
    label: 'gaming',
    thing: 'a level',
    plural: 'builds',
    maker: 'designer',
    place: 'a friend’s house, played by someone else',
    ev: ['School game design showcase', 'Local youth game jam'],
    win: 'finished two playable games or levels and collected feedback from players outside the family',
    won: 'Two playable games finished, played by people outside the family',
  },
];

export const FALLBACK: Interest = {
  label: 'what {he} chose',
  thing: 'a piece of work',
  plural: 'pieces',
  maker: 'expert',
  place: 'a local club, class or workshop where adults do it',
  ev: ['School showcase', 'Community event'],
  win: 'completed two finished pieces of work without help and shown both to people outside the family',
  won: 'Two finished pieces made alone, both shown in public',
} as Interest;

/** Keyword-matches the Ask step's free-text answer against INTERESTS, falling back to FALLBACK. */
export function readInterest(ask: string): Interest {
  const t = (ask || '').toLowerCase();
  for (const i of INTERESTS) {
    for (const m of i.match) {
      if (t.indexOf(m) !== -1) return i;
    }
  }
  const first = ((ask || '').split(',')[0] ?? '').trim();
  return first ? { ...FALLBACK, label: first.toLowerCase() } : FALLBACK;
}

export const PLANS: Record<string, Plan> = {
  football: {
    metric: 'Keepy-uppies in a row',
    goals: [
      'By day 30: {he} train{s} on {his} own four times a week and {his} own numbers are written down.',
      'By day 60: {he} {has} trained with a real team, been marked by a coach, and taught a drill.',
      'By day 90: sixty sessions logged, a competitive match played, and every number better than day one.',
    ],
    acts: [
      {
        n: '01',
        time: '15 min daily',
        title: 'A hundred touches a day',
        award: 'Streak keeper',
        objective: '24 sessions of 100 touches inside 30 days, each one logged here.',
        apply: 'Same wall or garage door, same time. No coach, nothing to book.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Sessions logged',
            target: 24,
            ph: 'Log today',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Keepy-uppies in a row today',
          },
        ],
      },
      {
        n: '02',
        time: '3 times a week',
        title: 'Weak foot only',
        award: 'Weak foot',
        objective: '12 sessions using the weak foot alone, 20 minutes each.',
        apply: 'One small-sided game played weak-foot only, in front of {his} friends.',
        do: [
          {
            k: 'weak',
            kind: 'count',
            label: 'Weak-foot sessions',
            target: 12,
            ph: 'Log one',
          },
          {
            k: 'note',
            kind: 'area',
            label: 'What got easier',
            ph: 'One line',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'Time the twenty metres',
        award: 'First number',
        objective: '{His} 20m sprint timed on day 1 and day 30, both recorded here.',
        apply: 'Two markers on the ground outside. {He} run{s}, you hold the phone.',
        do: [
          {
            k: 'sprint1',
            kind: 'num',
            label: 'Day 1 time (seconds)',
          },
          {
            k: 'sprint30',
            kind: 'num',
            label: 'Day 30 time (seconds)',
          },
        ],
      },
      {
        n: '04',
        time: 'Once this month',
        title: 'Train with a real team',
        award: 'Real team',
        objective: '1 club or school session attended, coach named, date logged.',
        apply: 'Turn up at the local ground on a Saturday and ask to train.',
        do: [
          {
            k: 'club',
            kind: 'text',
            label: 'Which team or club',
            ph: 'Name it',
          },
          {
            k: 'day',
            kind: 'date',
            label: 'Date {he} trained',
          },
          {
            k: 'coach',
            kind: 'text',
            label: 'Coach’s name',
          },
        ],
      },
      {
        n: '05',
        time: 'One evening',
        title: 'Ask the coach what to fix',
        award: 'Coach marked it',
        objective: '2 things to fix, in the coach’s words, written down by {him}.',
        apply: '{He} ask{s} directly: what should I fix first? Then {he} write{s} it down.',
        do: [
          {
            k: 'fix',
            kind: 'area',
            label: 'The two things to fix',
            ph: 'One per line',
          },
          {
            k: 'drill',
            kind: 'text',
            label: 'The drill {he} {was} given',
          },
        ],
      },
      {
        n: '06',
        time: 'One evening',
        title: 'Teach a drill to a younger player',
        award: 'First teacher',
        objective: '1 drill taught alone for 15 minutes — they can run it themselves after.',
        apply: 'Younger sibling, cousin or neighbour, on the same wall.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} taught',
            ph: 'Name and age',
          },
          {
            k: 'mins',
            kind: 'count',
            label: 'Minutes taught alone',
            target: 15,
            ph: 'Add 5 min',
            stepBy: 5,
          },
          {
            k: 'after',
            kind: 'area',
            label: 'What they could do afterwards',
            ph: 'One line',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Play a real fixture',
        award: 'First match',
        objective: '1 competitive match played, minutes and position logged.',
        apply: 'School team, street league or club friendly — a fixture with a result.',
        do: [
          {
            k: 'fixture',
            kind: 'text',
            label: 'The fixture',
            ph: 'Who against',
          },
          {
            k: 'played',
            kind: 'date',
            label: 'Date played',
          },
          {
            k: 'mins',
            kind: 'num',
            label: 'Minutes on the pitch',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Film the same skill again',
        award: 'Proof on film',
        objective: '2 stills of one skill — week one and week twelve — side by side.',
        apply: 'Phone propped on a bag, thirty seconds each. {He} pick{s} the skill.',
        do: [
          {
            k: 'clips',
            kind: 'photo',
            label: 'Import the before and after',
          },
          {
            k: 'skill',
            kind: 'text',
            label: 'Which skill',
            ph: 'Name it',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Beat {his} own numbers',
        award: 'Plan owner',
        objective:
          'Keepy-uppies and sprint time both better than day 1, month four written by {him}.',
        apply: '{He} tell{s} {his} coach the target for next month before {he} start{s} it.',
        do: [
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Keepy-uppies in a row now',
          },
          {
            k: 'sprint90',
            kind: 'num',
            label: '20m time now (seconds)',
          },
          {
            k: 'next',
            kind: 'area',
            label: 'What {he} set{s} for month four',
            ph: '{His} words',
          },
        ],
      },
    ],
  },
  drawing: {
    metric: 'Minutes for one finished sketch',
    goals: [
      'By day 30: {he} draw{s} daily and one finished piece is up where strangers see it.',
      'By day 60: {he} {has} drawn in public, been marked by an artist, and taught the grid method.',
      'By day 90: twelve finished drawings, three on display, one entered in a real competition.',
    ],
    acts: [
      {
        n: '01',
        time: '10 min daily',
        title: 'Ten minutes, same sketchbook',
        award: 'Streak keeper',
        objective: '20 dated pages inside 30 days, logged here by {him}.',
        apply: 'Same corner, same time. Nothing new to buy.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Pages logged',
            target: 20,
            ph: 'Log today',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Minutes for one finished sketch today',
          },
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'The same object, five angles',
        award: 'Five takes',
        objective: '5 drawings of one object from 5 angles, nothing rubbed out.',
        apply: 'A shoe, a hand, a tap — whatever is already in the room.',
        do: [
          {
            k: 'five',
            kind: 'photo',
            label: 'Import the five',
          },
          {
            k: 'object',
            kind: 'text',
            label: 'What {he} drew',
            ph: 'Name it',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'One piece on a public wall',
        award: 'First finish',
        objective: '1 finished drawing on display where people outside the family see it.',
        apply: 'School corridor, notice board, shop window. {He} ask{s} permission {himself}.',
        do: [
          {
            k: 'piece',
            kind: 'photo',
            label: 'Import the finished piece',
          },
          {
            k: 'up',
            kind: 'date',
            label: 'Date it went up',
          },
          {
            k: 'where',
            kind: 'text',
            label: 'Where it is',
            ph: 'Place',
          },
        ],
      },
      {
        n: '04',
        time: 'Twice this month',
        title: 'Draw in public',
        award: 'Drew in public',
        objective: '3 sketches made outside the house, with strangers in view.',
        apply: 'Park bench, bus stop, market. {He} sit{s} down and draws.',
        do: [
          {
            k: 'outside',
            kind: 'count',
            label: 'Sketches done outside',
            target: 3,
            ph: 'Log one',
          },
          {
            k: 'public',
            kind: 'photo',
            label: 'Import them',
          },
        ],
      },
      {
        n: '05',
        time: 'Once this month',
        title: 'Have an artist mark it',
        award: 'Artist marked it',
        objective: '2 corrections from a working artist, written in {his} words.',
        apply: 'Art teacher, local studio, or a reply to a comment {he} send{s}.',
        do: [
          {
            k: 'artist',
            kind: 'text',
            label: 'Who marked it',
            ph: 'Name',
          },
          {
            k: 'notes',
            kind: 'area',
            label: 'The two corrections',
            ph: 'One per line',
          },
        ],
      },
      {
        n: '06',
        time: 'One evening',
        title: 'Teach the grid method',
        award: 'First teacher',
        objective: '1 lesson taught alone, 15 minutes — they copy a face using the grid.',
        apply: 'Younger cousin or neighbour. No adult hands on the pencil.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} taught',
            ph: 'Name and age',
          },
          {
            k: 'mins',
            kind: 'count',
            label: 'Minutes taught alone',
            target: 15,
            ph: 'Add 5 min',
            stepBy: 5,
          },
          {
            k: 'after',
            kind: 'area',
            label: 'What they could do afterwards',
            ph: 'One line',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Draw what someone asked for',
        award: 'First commission',
        objective: '1 drawing made to someone else’s request, delivered inside 2 weeks.',
        apply: '{He} ask{s} what they want, delivers it, then asks what would make it better.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who asked',
            ph: 'Name',
          },
          {
            k: 'delivered',
            kind: 'date',
            label: 'Delivered on',
          },
          {
            k: 'feedback',
            kind: 'area',
            label: 'What they said',
            ph: 'And what {he} changed',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Twelve pages, laid out',
        award: 'Portfolio of twelve',
        objective: '12 finished drawings imported here, 3 chosen by {him}.',
        apply: '{He} lay{s} them on the floor and argues for {his} favourite out loud.',
        do: [
          {
            k: 'twelve',
            kind: 'photo',
            label: 'Import the twelve',
          },
          {
            k: 'fav',
            kind: 'text',
            label: 'The one {he} defend{s}',
            ph: 'Which',
          },
          {
            k: 'why',
            kind: 'area',
            label: 'Why that one',
            ph: '{His} argument',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Enter the competition',
        award: 'Entered for real',
        objective: '1 competition entered before its closing date, tracked step by step here.',
        apply: '{He} fill{s} the entry form {himself}. You only pay the fee.',
        do: [
          {
            k: 'comp',
            kind: 'text',
            label: 'Which competition',
            ph: 'Name it',
          },
          {
            k: 'closing',
            kind: 'date',
            label: 'Entries close',
          },
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Minutes for one finished sketch now',
          },
        ],
      },
    ],
  },
  building: {
    metric: 'Minutes to build {his} test rig from scratch',
    goals: [
      'By day 30: {he} build{s} daily at a fixed bench and one working thing {he} made is in use.',
      'By day 60: {he} {has} repaired something for a stranger, seen a real workshop, and taught a build.',
      'By day 90: two working builds out in the world and a design {he} drew before {he} built it.',
    ],
    acts: [
      {
        n: '01',
        time: '20 min daily',
        title: 'Twenty minutes at the bench',
        award: 'Streak keeper',
        objective: '20 sessions inside 30 days, every one dated here.',
        apply: 'One shelf or box that stays set up. Nothing new to buy.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Sessions logged',
            target: 20,
            ph: 'Log today',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Minutes to build {his} test rig today',
          },
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'Take one thing apart',
        award: 'Stripped and named',
        objective: '4 devices opened, every part named and photographed.',
        apply: 'Dead torch, old clock, a broken toy from the neighbours.',
        do: [
          {
            k: 'opened',
            kind: 'count',
            label: 'Things opened',
            target: 4,
            ph: 'Log one',
          },
          {
            k: 'parts',
            kind: 'photo',
            label: 'Import the parts laid out',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'One working build, given away',
        award: 'First finish',
        objective: '1 build that works, handed to someone outside the family.',
        apply: 'Someone asks for it, {he} make{s} it, they keep it and use it.',
        do: [
          {
            k: 'build',
            kind: 'photo',
            label: 'Import the finished build',
          },
          {
            k: 'who',
            kind: 'text',
            label: 'Who has it',
            ph: 'Name',
          },
          {
            k: 'given',
            kind: 'date',
            label: 'Handed over on',
          },
        ],
      },
      {
        n: '04',
        time: 'Twice this month',
        title: 'Fix something for a neighbour',
        award: 'First repair',
        objective: '2 repairs done for people outside the house, both working after.',
        apply: 'A note on the door: broken things looked at, free.',
        do: [
          {
            k: 'fixes',
            kind: 'count',
            label: 'Repairs done',
            target: 2,
            ph: 'Log one',
          },
          {
            k: 'what',
            kind: 'area',
            label: 'What {he} fixed',
            ph: 'One per line',
          },
        ],
      },
      {
        n: '05',
        time: 'Once this month',
        title: 'Inside a real workshop',
        award: 'Field visit',
        objective: '1 visit to a repair shop or maker space, 2 questions asked, 1 contact named.',
        apply: 'Walk in and ask what they are working on today.',
        do: [
          {
            k: 'place',
            kind: 'text',
            label: 'Where {he} went',
            ph: 'Shop or space',
          },
          {
            k: 'qs',
            kind: 'area',
            label: 'The two questions',
            ph: 'One per line',
          },
          {
            k: 'contact',
            kind: 'text',
            label: 'Named contact',
            ph: 'Who {he} can go back to',
          },
        ],
      },
      {
        n: '06',
        time: 'One evening',
        title: 'Teach the build',
        award: 'First teacher',
        objective: '1 build taught in 15 minutes — they finish it with their own hands.',
        apply: 'No adult on the tools but {him}.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} taught',
            ph: 'Name and age',
          },
          {
            k: 'mins',
            kind: 'count',
            label: 'Minutes taught alone',
            target: 15,
            ph: 'Add 5 min',
            stepBy: 5,
          },
          {
            k: 'after',
            kind: 'area',
            label: 'What they could do afterwards',
            ph: 'One line',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Build to someone else’s spec',
        award: 'First request met',
        objective: '1 build made to a real request, delivered inside 2 weeks.',
        apply: '{He} ask{s} what it has to do, then delivers and takes the feedback.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who asked',
            ph: 'Name',
          },
          {
            k: 'delivered',
            kind: 'date',
            label: 'Delivered on',
          },
          {
            k: 'feedback',
            kind: 'area',
            label: 'What they said',
            ph: 'And what {he} changed',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Draw it before {he} build{s} it',
        award: 'Designed then built',
        objective: '1 drawing made first, then the finished build beside it.',
        apply: 'Paper before parts. {He} explain{s} where it went off plan.',
        do: [
          {
            k: 'design',
            kind: 'photo',
            label: 'Import the drawing and the build',
          },
          {
            k: 'diff',
            kind: 'text',
            label: 'What changed from the drawing',
            ph: 'One line',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Show three, defend one',
        award: 'Plan owner',
        objective: '3 builds shown, 1 defended out loud, month four written by {him}.',
        apply: '{He} present{s} them at the workshop or to a teacher and takes the questions.',
        do: [
          {
            k: 'three',
            kind: 'photo',
            label: 'Import the three builds',
          },
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Minutes to build the test rig now',
          },
          {
            k: 'next',
            kind: 'area',
            label: 'What {he} set{s} for month four',
            ph: '{His} words',
          },
        ],
      },
    ],
  },
  animals: {
    metric: 'Species {he} can name on sight',
    goals: [
      'By day 30: {he} log{s} animals daily and can name twenty species on sight.',
      'By day 60: {he} {has} worked a shift where animals are cared for and questioned a vet.',
      'By day 90: thirty observations logged, two shifts done, and a finding of {his} own presented.',
    ],
    acts: [
      {
        n: '01',
        time: '15 min daily',
        title: 'Fifteen minutes of watching',
        award: 'Streak keeper',
        objective: '20 dated observations inside 30 days.',
        apply: 'Same window, balcony or street corner. Watched, not looked up.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Observations logged',
            target: 20,
            ph: 'Log today',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Species {he} can name today',
          },
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'One species, properly',
        award: 'Field notes',
        objective: '4 species written up: what it eats, where it sleeps, how it behaves.',
        apply: 'Watched in person first. Books only to check afterwards.',
        do: [
          {
            k: 'species',
            kind: 'count',
            label: 'Species written up',
            target: 4,
            ph: 'Log one',
          },
          {
            k: 'notes',
            kind: 'area',
            label: 'This week’s species',
            ph: 'What {he} saw',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'The log, in {his} handwriting',
        award: 'First finish',
        objective: '30 observations in one log, imported here and shown to 3 people.',
        apply: '{He} hand{s} the log to someone outside the family and talks them through it.',
        do: [
          {
            k: 'log',
            kind: 'photo',
            label: 'Import the log pages',
          },
          {
            k: 'seen',
            kind: 'text',
            label: 'Three people who saw it',
            ph: 'Names',
          },
        ],
      },
      {
        n: '04',
        time: 'Once this month',
        title: 'A shift where animals are cared for',
        award: 'First shift',
        objective: '1 volunteer shift at a shelter, vet or park, hours logged.',
        apply: '{He} phone{s} and asks {himself}. You drive, nothing more.',
        do: [
          {
            k: 'place',
            kind: 'text',
            label: 'Where',
            ph: 'Shelter, vet or park',
          },
          {
            k: 'day',
            kind: 'date',
            label: 'Date of the shift',
          },
          {
            k: 'hours',
            kind: 'num',
            label: 'Hours worked',
          },
        ],
      },
      {
        n: '05',
        time: 'One evening',
        title: 'Two questions for a vet',
        award: 'Expert answered',
        objective: '2 questions asked of a vet or warden, answers in {his} words.',
        apply: 'In person, by email or at the shelter desk.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} asked',
            ph: 'Name and role',
          },
          {
            k: 'ans',
            kind: 'area',
            label: 'What they said',
            ph: 'Short version',
          },
        ],
      },
      {
        n: '06',
        time: 'One evening',
        title: 'Teach one species',
        award: 'First teacher',
        objective: '1 lesson taught alone, 15 minutes, on an animal {he} know{s} well.',
        apply: 'Younger child, in the park, pointing at the real thing.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} taught',
            ph: 'Name and age',
          },
          {
            k: 'mins',
            kind: 'count',
            label: 'Minutes taught alone',
            target: 15,
            ph: 'Add 5 min',
            stepBy: 5,
          },
          {
            k: 'after',
            kind: 'area',
            label: 'What they could do afterwards',
            ph: 'One line',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Answer a question nobody asked',
        award: 'Own finding',
        objective: '1 pattern {he} noticed, tracked over 2 weeks, written in 3 sentences.',
        apply: '{His} own observation, not a fact from a book.',
        do: [
          {
            k: 'finding',
            kind: 'area',
            label: 'The finding, three sentences',
            ph: '{His} words',
          },
          {
            k: 'evidence',
            kind: 'photo',
            label: 'Import the evidence',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Second shift, on {his} own',
        award: 'Two shifts',
        objective: '2nd shift completed, with one task {he} did without being told.',
        apply: 'Same place, second time. They know {his} name now.',
        do: [
          {
            k: 'day2',
            kind: 'date',
            label: 'Date of the second shift',
          },
          {
            k: 'task',
            kind: 'text',
            label: 'What {he} did unasked',
            ph: 'One line',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Present the log',
        award: 'Plan owner',
        objective: 'The log presented to a class or club, every question taken by {him}.',
        apply: 'Ten minutes in front of people. You sit at the back.',
        do: [
          {
            k: 'where',
            kind: 'text',
            label: 'Where {he} presented',
            ph: 'Class or club',
          },
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Species {he} can name now',
          },
          {
            k: 'next',
            kind: 'area',
            label: 'What {he} set{s} for month four',
            ph: '{His} words',
          },
        ],
      },
    ],
  },
  space: {
    metric: 'Objects {he} can find in the sky unaided',
    goals: [
      'By day 30: {he} {is} outside on clear nights and can find five objects with no help.',
      'By day 60: {he} {has} looked through a real telescope and questioned an astronomer.',
      'By day 90: twenty observations, predictions that came true, and a talk given.',
    ],
    acts: [
      {
        n: '01',
        time: '10 min nightly',
        title: 'Ten minutes under the sky',
        award: 'Streak keeper',
        objective: '20 dated sky entries inside 30 days.',
        apply: 'Balcony, roof or street. Phone stays in {his} pocket.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Nights logged',
            target: 20,
            ph: 'Log tonight',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Objects {he} can find unaided today',
          },
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'Track the moon for a month',
        award: 'Moon log',
        objective: '4 weekly sketches of the moon, dated and kept.',
        apply: 'Drawn from what {he} see{s}, not copied from a chart.',
        do: [
          {
            k: 'moon',
            kind: 'photo',
            label: 'Import the moon sketches',
          },
          {
            k: 'note',
            kind: 'text',
            label: 'What surprised {him}',
            ph: 'One line',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'The sky log, written up',
        award: 'First finish',
        objective: '20 observations logged and shown to 3 people outside the family.',
        apply: '{He} talk{s} someone through one page of it, outdoors, pointing up.',
        do: [
          {
            k: 'log',
            kind: 'photo',
            label: 'Import the log pages',
          },
          {
            k: 'seen',
            kind: 'text',
            label: 'Three people who saw it',
            ph: 'Names',
          },
        ],
      },
      {
        n: '04',
        time: 'Once this month',
        title: 'A night with a club',
        award: 'Field visit',
        objective: '1 club night attended, 1 object seen through a real telescope.',
        apply: 'Astronomy club, college observatory or a neighbour with a scope.',
        do: [
          {
            k: 'club',
            kind: 'text',
            label: 'Which club',
            ph: 'Name it',
          },
          {
            k: 'day',
            kind: 'date',
            label: 'Date',
          },
          {
            k: 'object',
            kind: 'text',
            label: 'What {he} saw through it',
            ph: 'Name it',
          },
        ],
      },
      {
        n: '05',
        time: 'One evening',
        title: 'Two questions for an astronomer',
        award: 'Expert answered',
        objective: '2 questions asked, answers written in {his} words.',
        apply: 'At the club, by email, or in a reply {he} write{s} {himself}.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} asked',
            ph: 'Name and role',
          },
          {
            k: 'ans',
            kind: 'area',
            label: 'What they said',
            ph: 'Short version',
          },
        ],
      },
      {
        n: '06',
        time: 'One evening',
        title: 'Teach the sky',
        award: 'First teacher',
        objective: '1 lesson, 15 minutes — a younger child finds one object alone.',
        apply: 'Outside, at night, nobody pointing but {him}.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} taught',
            ph: 'Name and age',
          },
          {
            k: 'mins',
            kind: 'count',
            label: 'Minutes taught alone',
            target: 15,
            ph: 'Add 5 min',
            stepBy: 5,
          },
          {
            k: 'after',
            kind: 'area',
            label: 'What they could do afterwards',
            ph: 'One line',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Predict, then check',
        award: 'Own prediction',
        objective: '3 predictions written before the night and checked after.',
        apply: 'Where the moon rises, when a planet appears. Written first.',
        do: [
          {
            k: 'preds',
            kind: 'count',
            label: 'Predictions checked',
            target: 3,
            ph: 'Log one',
          },
          {
            k: 'pred',
            kind: 'area',
            label: 'The predictions and results',
            ph: 'One per line',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Photograph one object',
        award: 'First image',
        objective: '1 photograph of the moon or a planet, taken by {him}.',
        apply: 'Phone through the eyepiece counts. {His} hands, {his} framing.',
        do: [
          {
            k: 'shot',
            kind: 'photo',
            label: 'Import the photograph',
          },
          {
            k: 'how',
            kind: 'text',
            label: 'How {he} took it',
            ph: 'One line',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Give the talk',
        award: 'Plan owner',
        objective: '1 talk given to a class or club, every question taken by {him}.',
        apply: 'Ten minutes and {his} own log on the screen behind {him}.',
        do: [
          {
            k: 'where',
            kind: 'text',
            label: 'Where {he} spoke',
            ph: 'Class or club',
          },
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Objects {he} can find now',
          },
          {
            k: 'next',
            kind: 'area',
            label: 'What {he} set{s} for month four',
            ph: '{His} words',
          },
        ],
      },
    ],
  },
  music: {
    metric: 'Bars {he} can play from memory',
    goals: [
      'By day 30: {he} practise{s} daily and has played for people outside the family.',
      'By day 60: {he} {has} played alongside other musicians and been marked by a teacher.',
      'By day 90: two pieces from memory, performed to an audience {he} booked {himself}.',
    ],
    acts: [
      {
        n: '01',
        time: '15 min daily',
        title: 'Fifteen minutes, every day',
        award: 'Streak keeper',
        objective: '20 dated practice sessions inside 30 days.',
        apply: 'Same seat, same time. Instrument left out, not packed away.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Sessions logged',
            target: 20,
            ph: 'Log today',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Bars from memory today',
          },
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'Slow it down until it is clean',
        award: 'Clean at speed',
        objective: '1 passage played 5 times with no mistake, slow then up to tempo.',
        apply: '{He} set{s} the tempo {himself} and refuses to move up too early.',
        do: [
          {
            k: 'clean',
            kind: 'count',
            label: 'Clean run-throughs',
            target: 5,
            ph: 'Log one',
          },
          {
            k: 'note',
            kind: 'area',
            label: 'Which bar keeps breaking',
            ph: 'One line',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'Play for three people',
        award: 'First audience',
        objective: '1 piece played start to finish for 3 people outside the family.',
        apply: 'Neighbours, a family gathering, the end of a school day.',
        do: [
          {
            k: 'day',
            kind: 'date',
            label: 'Date {he} played',
          },
          {
            k: 'who',
            kind: 'text',
            label: 'Who listened',
            ph: 'Names',
          },
          {
            k: 'felt',
            kind: 'area',
            label: 'What {he} noticed after',
            ph: 'One line',
          },
        ],
      },
      {
        n: '04',
        time: 'Twice this month',
        title: 'Play with someone else',
        award: 'Played together',
        objective: '2 sessions played alongside another musician, in time.',
        apply: 'A friend, a cousin, the school band. Anyone keeping time with {him}.',
        do: [
          {
            k: 'together',
            kind: 'count',
            label: 'Sessions together',
            target: 2,
            ph: 'Log one',
          },
          {
            k: 'who',
            kind: 'text',
            label: 'Who with',
            ph: 'Name',
          },
        ],
      },
      {
        n: '05',
        time: 'One evening',
        title: 'Two corrections from a teacher',
        award: 'Teacher marked it',
        objective: '2 things to fix, from a working musician, in {his} words.',
        apply: '{He} play{s} it for them and asks what to fix first.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who marked it',
            ph: 'Name',
          },
          {
            k: 'notes',
            kind: 'area',
            label: 'The two corrections',
            ph: 'One per line',
          },
        ],
      },
      {
        n: '06',
        time: 'One evening',
        title: 'Teach the first four bars',
        award: 'First teacher',
        objective: '1 lesson, 15 minutes — the child plays four bars alone after.',
        apply: 'Same instrument, {his} hands off it.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} taught',
            ph: 'Name and age',
          },
          {
            k: 'mins',
            kind: 'count',
            label: 'Minutes taught alone',
            target: 15,
            ph: 'Add 5 min',
            stepBy: 5,
          },
          {
            k: 'after',
            kind: 'area',
            label: 'What they could do afterwards',
            ph: 'One line',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Learn a piece someone asked for',
        award: 'First request met',
        objective: '1 piece learned on request and played for the person who asked.',
        apply: 'Someone names a song. {He} learn{s} it and plays it to them.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who asked',
            ph: 'Name',
          },
          {
            k: 'played',
            kind: 'date',
            label: 'Played for them on',
          },
          {
            k: 'feedback',
            kind: 'area',
            label: 'What they said',
            ph: 'Short version',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Record both pieces',
        award: 'On record',
        objective: '2 recordings made, imported here, listened back to once.',
        apply: 'One take each, phone on a chair. No edits.',
        do: [
          {
            k: 'rec',
            kind: 'photo',
            label: 'Import the recordings or stills',
          },
          {
            k: 'hear',
            kind: 'area',
            label: 'What {he} heard on playback',
            ph: 'One line',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Perform it',
        award: 'Plan owner',
        objective: '1 performance outside the family, on a date {he} booked {himself}.',
        apply: 'Assembly, open mic, family gathering {he} organised. You only turn up.',
        do: [
          {
            k: 'where',
            kind: 'text',
            label: 'Where {he} performed',
            ph: 'Name it',
          },
          {
            k: 'date',
            kind: 'date',
            label: 'Date',
          },
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Bars from memory now',
          },
        ],
      },
    ],
  },
  reading: {
    metric: 'Pages {he} read{s} in twenty minutes',
    goals: [
      'By day 30: {he} read{s} daily and has written three reviews in {his} own words.',
      'By day 60: {he} {has} argued a book out loud and questioned someone who writes.',
      'By day 90: twelve books finished, twelve reviews written, one spoken about in public.',
    ],
    acts: [
      {
        n: '01',
        time: '20 min daily',
        title: 'Twenty minutes, no screen',
        award: 'Streak keeper',
        objective: '20 dated reading sessions inside 30 days.',
        apply: 'Same chair, same time, phone in another room.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Sessions logged',
            target: 20,
            ph: 'Log today',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Pages in twenty minutes today',
          },
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'A review in five sentences',
        award: 'First reviews',
        objective: '4 reviews written by {him}, 5 sentences each, kept here.',
        apply: 'Written for someone deciding whether to read it.',
        do: [
          {
            k: 'reviews',
            kind: 'count',
            label: 'Reviews written',
            target: 4,
            ph: 'Log one',
          },
          {
            k: 'review',
            kind: 'area',
            label: 'This week’s review',
            ph: 'Five sentences',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'Finish three books',
        award: 'Three finished',
        objective: '3 books finished, titles and dates logged here.',
        apply: 'Chosen by {him}, including one {he} would not normally pick.',
        do: [
          {
            k: 'titles',
            kind: 'text',
            label: 'The three titles',
            ph: 'Separate with commas',
          },
          {
            k: 'third',
            kind: 'date',
            label: 'Third one finished on',
          },
        ],
      },
      {
        n: '04',
        time: 'Twice this month',
        title: 'Defend a book out loud',
        award: 'Held the argument',
        objective: '2 discussions where {he} bring{s} evidence from the text.',
        apply: 'At the table, with someone who disagrees. {He} quote{s} the page.',
        do: [
          {
            k: 'args',
            kind: 'count',
            label: 'Discussions held',
            target: 2,
            ph: 'Log one',
          },
          {
            k: 'point',
            kind: 'area',
            label: 'The point {he} defended',
            ph: 'One line',
          },
        ],
      },
      {
        n: '05',
        time: 'Once this month',
        title: 'Question a writer or librarian',
        award: 'Expert answered',
        objective: '2 questions asked of someone who writes or works with books.',
        apply: 'Library desk, school visit, or an email {he} send{s} {himself}.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} asked',
            ph: 'Name and role',
          },
          {
            k: 'ans',
            kind: 'area',
            label: 'What they said',
            ph: 'Short version',
          },
        ],
      },
      {
        n: '06',
        time: 'Four evenings',
        title: 'Read aloud to someone younger',
        award: 'First teacher',
        objective: '4 sessions read aloud to a younger child, 15 minutes each.',
        apply: '{He} pick{s} the book and does the voices.',
        do: [
          {
            k: 'reads',
            kind: 'count',
            label: 'Sessions read aloud',
            target: 4,
            ph: 'Log one',
          },
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} read to',
            ph: 'Name and age',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Recommend for a real reader',
        award: 'First request met',
        objective: '1 recommendation written for someone else, with {his} reasons.',
        apply: 'They tell {him} what they like. {He} pick{s} and explains why.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who asked',
            ph: 'Name',
          },
          {
            k: 'rec',
            kind: 'area',
            label: 'What {he} recommended, and why',
            ph: 'Short version',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'The twelve, on one page',
        award: 'Portfolio of twelve',
        objective: '12 titles and reviews imported here, 1 chosen as best.',
        apply: '{He} read{s} {his} favourite review out loud to you.',
        do: [
          {
            k: 'pages',
            kind: 'photo',
            label: 'Import the review pages',
          },
          {
            k: 'fav',
            kind: 'text',
            label: '{His} best book',
            ph: 'Title',
          },
          {
            k: 'why',
            kind: 'area',
            label: 'Why that one',
            ph: '{His} argument',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Speak about one',
        award: 'Plan owner',
        objective: '1 talk or storytelling session given in public, questions taken by {him}.',
        apply: 'Library session, class talk, debate. {He} book{s} it.',
        do: [
          {
            k: 'where',
            kind: 'text',
            label: 'Where {he} spoke',
            ph: 'Name it',
          },
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Pages in twenty minutes now',
          },
          {
            k: 'next',
            kind: 'area',
            label: 'What {he} set{s} for month four',
            ph: '{His} words',
          },
        ],
      },
    ],
  },
  cooking: {
    metric: 'Dishes {he} can cook with no recipe',
    goals: [
      'By day 30: {he} cook{s} weekly without help and one dish is properly {his}.',
      'By day 60: {he} {has} shopped to a budget {he} set and cooked beside a professional.',
      'By day 90: four dishes with no recipe and a full meal {he} ran end to end.',
    ],
    acts: [
      {
        n: '01',
        time: '4 times a week',
        title: 'Twenty minutes in the kitchen',
        award: 'Streak keeper',
        objective: '16 sessions inside 30 days, knife and heat included.',
        apply: 'Same time each week. {He} start{s} it, you stay out.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Sessions logged',
            target: 16,
            ph: 'Log today',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Dishes with no recipe today',
          },
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'One dish until it is {his}',
        award: 'Owns one dish',
        objective: '1 dish cooked 4 times — no recipe by the fourth.',
        apply: 'The same dish, four weeks running, until {his} hands know it.',
        do: [
          {
            k: 'reps',
            kind: 'count',
            label: 'Times cooked',
            target: 4,
            ph: 'Log one',
          },
          {
            k: 'dish',
            kind: 'photo',
            label: 'Import the dish',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'Cook for three people',
        award: 'First service',
        objective: '1 dish cooked alone and served to 3 people outside the family.',
        apply: 'Neighbours or friends at the table. {He} serve{s} it {himself}.',
        do: [
          {
            k: 'day',
            kind: 'date',
            label: 'Date {he} served it',
          },
          {
            k: 'who',
            kind: 'text',
            label: 'Who ate it',
            ph: 'Names',
          },
          {
            k: 'plate',
            kind: 'photo',
            label: 'Import the plate',
          },
        ],
      },
      {
        n: '04',
        time: 'Twice this month',
        title: 'Shop it {himself}, to a budget',
        award: 'Budget held',
        objective: '2 shops planned and paid inside the budget {he} set.',
        apply: '{He} carr{ies} the list and the cash, and does the talking.',
        do: [
          {
            k: 'shops',
            kind: 'count',
            label: 'Shops done',
            target: 2,
            ph: 'Log one',
          },
          {
            k: 'budget',
            kind: 'num',
            label: 'The budget {he} set',
          },
        ],
      },
      {
        n: '05',
        time: 'Once this month',
        title: 'Inside a working kitchen',
        award: 'Field visit',
        objective: '1 visit to a working kitchen, 2 questions asked, 1 contact named.',
        apply: 'Off-hours at a local restaurant or a canteen {he} ask{s} {himself}.',
        do: [
          {
            k: 'place',
            kind: 'text',
            label: 'Where {he} went',
            ph: 'Name it',
          },
          {
            k: 'qs',
            kind: 'area',
            label: 'The two questions',
            ph: 'One per line',
          },
          {
            k: 'contact',
            kind: 'text',
            label: 'Named contact',
            ph: 'Who {he} can go back to',
          },
        ],
      },
      {
        n: '06',
        time: 'One evening',
        title: 'Teach the knife',
        award: 'First teacher',
        objective: '1 lesson, 15 minutes — they chop safely on their own after.',
        apply: '{His} rules, {his} demonstration, your hands off.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} taught',
            ph: 'Name and age',
          },
          {
            k: 'mins',
            kind: 'count',
            label: 'Minutes taught alone',
            target: 15,
            ph: 'Add 5 min',
            stepBy: 5,
          },
          {
            k: 'after',
            kind: 'area',
            label: 'What they could do afterwards',
            ph: 'One line',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Cook what someone requested',
        award: 'First request met',
        objective: '1 dish cooked on request, feedback taken and acted on.',
        apply: 'They name it, {he} cook{s} it, then {he} ask{s} what to change.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who asked',
            ph: 'Name',
          },
          {
            k: 'cooked',
            kind: 'date',
            label: 'Cooked on',
          },
          {
            k: 'feedback',
            kind: 'area',
            label: 'What they said',
            ph: 'And what {he} changed',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Plan a full meal',
        award: 'Menu owner',
        objective: '3 courses written, costed and shopped for by {him}.',
        apply: '{He} write{s} the menu and the list before anyone spends anything.',
        do: [
          {
            k: 'menu',
            kind: 'area',
            label: 'The three courses',
            ph: 'One per line',
          },
          {
            k: 'cost',
            kind: 'num',
            label: 'What it cost',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Run the dinner',
        award: 'Plan owner',
        objective: '1 meal cooked and served to guests, start to finish, alone.',
        apply: '{He} set{s} the date, invites them and runs the kitchen. You sit down.',
        do: [
          {
            k: 'date',
            kind: 'date',
            label: 'Date of the dinner',
          },
          {
            k: 'table',
            kind: 'photo',
            label: 'Import the table',
          },
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Dishes with no recipe now',
          },
        ],
      },
    ],
  },
  gaming: {
    metric: 'Players who finish {his} level',
    goals: [
      'By day 30: {he} build{s} most days and one level of {his} has been finished by someone else.',
      'By day 60: {he} {has} rebuilt a level from real feedback and questioned someone who ships games.',
      'By day 90: two finished levels, five outside playtesters, and one jam entered.',
    ],
    acts: [
      {
        n: '01',
        time: '30 min daily',
        title: 'Thirty minutes building, not playing',
        award: 'Streak keeper',
        objective: '20 dated build sessions inside 30 days — building only.',
        apply: 'Editor open, game closed. Same slot every day.',
        do: [
          {
            k: 'sessions',
            kind: 'count',
            label: 'Build sessions logged',
            target: 20,
            ph: 'Log today',
          },
          {
            k: 'metricBase',
            kind: 'num',
            label: 'Players who finish it today',
          },
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'Watch someone play it',
        award: 'First playtest',
        objective: '4 playtests watched in silence, notes written straight after.',
        apply: '{He} sit{s} on {his} hands and says nothing while they play.',
        do: [
          {
            k: 'tests',
            kind: 'count',
            label: 'Playtests watched',
            target: 4,
            ph: 'Log one',
          },
          {
            k: 'notes',
            kind: 'area',
            label: 'Where they got stuck',
            ph: 'One per line',
          },
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'One finished, playable level',
        award: 'First finish',
        objective: '1 level anyone can finish without {him} explaining it.',
        apply: 'Handed to someone outside the family, on their device.',
        do: [
          {
            k: 'level',
            kind: 'photo',
            label: 'Import screenshots of the level',
          },
          {
            k: 'who',
            kind: 'text',
            label: 'Who finished it',
            ph: 'Name',
          },
        ],
      },
      {
        n: '04',
        time: 'Twice this month',
        title: 'Rebuild from the feedback',
        award: 'Acted on feedback',
        objective: '2 changes made because a player struggled, both retested.',
        apply: 'The change is theirs, not {his} opinion.',
        do: [
          {
            k: 'changes',
            kind: 'count',
            label: 'Changes retested',
            target: 2,
            ph: 'Log one',
          },
          {
            k: 'change',
            kind: 'area',
            label: 'What {he} changed and why',
            ph: 'One per line',
          },
        ],
      },
      {
        n: '05',
        time: 'Once this month',
        title: 'Question someone who ships games',
        award: 'Expert answered',
        objective: '2 questions asked of a working game maker, answers logged.',
        apply: 'A studio email, a jam organiser, a dev reply {he} write{s} {himself}.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} asked',
            ph: 'Name and role',
          },
          {
            k: 'ans',
            kind: 'area',
            label: 'What they said',
            ph: 'Short version',
          },
        ],
      },
      {
        n: '06',
        time: 'One evening',
        title: 'Teach the editor',
        award: 'First teacher',
        objective: '1 lesson, 15 minutes — they build a room on their own after.',
        apply: '{His} keyboard, their hands.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who {he} taught',
            ph: 'Name and age',
          },
          {
            k: 'mins',
            kind: 'count',
            label: 'Minutes taught alone',
            target: 15,
            ph: 'Add 5 min',
            stepBy: 5,
          },
          {
            k: 'after',
            kind: 'area',
            label: 'What they could do afterwards',
            ph: 'One line',
          },
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Build what a player asked for',
        award: 'First request met',
        objective: '1 level built to someone else’s request, delivered in 2 weeks.',
        apply: 'They describe it, {he} build{s} it, they play it in front of {him}.',
        do: [
          {
            k: 'who',
            kind: 'text',
            label: 'Who asked',
            ph: 'Name',
          },
          {
            k: 'delivered',
            kind: 'date',
            label: 'Delivered on',
          },
          {
            k: 'feedback',
            kind: 'area',
            label: 'What they said',
            ph: 'And what {he} changed',
          },
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Five players, outside the family',
        award: 'Five playtests',
        objective: '5 outside players finish it, completion times logged.',
        apply: 'School friends, cousins, the neighbour’s kids. Timed.',
        do: [
          {
            k: 'players',
            kind: 'count',
            label: 'Players who finished',
            target: 5,
            ph: 'Log one',
          },
          {
            k: 'times',
            kind: 'area',
            label: 'Their completion times',
            ph: 'One per line',
          },
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Enter a jam or showcase',
        award: 'Plan owner',
        objective: '1 jam or school showcase entered, on a date {he} booked.',
        apply: '{He} submit{s} the build {himself}, before the deadline.',
        do: [
          {
            k: 'where',
            kind: 'text',
            label: 'Which jam or showcase',
            ph: 'Name it',
          },
          {
            k: 'date',
            kind: 'date',
            label: 'Entry date',
          },
          {
            k: 'metricBest',
            kind: 'num',
            label: 'Players who finish it now',
          },
        ],
      },
    ],
  },
};

export const FB_TAGS = ['Too hard', 'Too easy', 'No time this week', 'Loved it'] as const;
export type FeedbackTag = (typeof FB_TAGS)[number];

export const FB_ACK: Record<FeedbackTag, string> = {
  'Too hard': 'Eased right away \u2014 the session targets below are lower now.',
  'Too easy': 'Raised right away \u2014 the session targets below are higher now.',
  'No time this week': 'Relaxed \u2014 one session is enough here, on no fixed schedule.',
  'Loved it': 'Noted \u2014 more of this kind of activity next month.',
};

/** Adjusts a count field's target based on the feedback tag applied to its activity. */
export function adjTarget(tag: FeedbackTag | null | undefined, target: number | undefined): number {
  const n = target ?? 1;
  if (tag === 'Too hard') return Math.max(1, Math.round(n * 0.6));
  if (tag === 'Too easy') return Math.ceil(n * 1.5);
  if (tag === 'No time this week') return 1;
  return n;
}

export const TRACK: TrackStep[] = [
  {
    title: 'Find the competition',
    short: 'Find',
    when: 'Week 1',
    body: 'One with a real closing date.',
    paths: ['M7 11h34v25H7z', 'M19 17h10v13H19z', 'M24 17v-4'],
    fields: [
      {
        k: 'comp',
        label: 'Which competition',
        ph: 'Name it',
        type: 'text',
      },
      {
        k: 'close',
        label: 'Entries close',
        type: 'date',
      },
    ],
  },
  {
    title: 'Read the brief',
    short: 'Brief',
    when: 'Week 1',
    body: 'Theme, size, medium, deadline — on one card.',
    paths: ['M13 7h22v34H13z', 'M19 16h10', 'M19 23h10', 'M19 30h6'],
    fields: [
      {
        k: 'theme',
        label: 'Theme',
        ph: 'In {his} words',
        type: 'text',
      },
      {
        k: 'spec',
        label: 'Size and medium',
        ph: 'A3, coloured pencil',
        type: 'text',
      },
    ],
  },
  {
    title: 'Three rough ideas',
    short: 'Ideas',
    when: 'Week 2',
    body: 'Three takes on the theme. Nothing rubbed out.',
    paths: [
      'M5 18h11v13H5z',
      'M18.5 18h11v13h-11z',
      'M32 18h11v13H32z',
      'M8 25h5',
      'M21.5 25h5',
      'M35 25h5',
    ],
    up: {
      key: 'ideas',
      label: 'Import the rough sketches',
      hint: 'Photograph or scan the three. Drop them here or click Import.',
    },
    fields: [
      {
        k: 'i1',
        label: 'Idea 1',
        ph: 'One line',
        type: 'text',
      },
      {
        k: 'i2',
        label: 'Idea 2',
        ph: 'One line',
        type: 'text',
      },
      {
        k: 'i3',
        label: 'Idea 3',
        ph: 'One line',
        type: 'text',
      },
    ],
  },
  {
    title: '{He} pick{s} one',
    short: 'Pick',
    when: 'Week 2',
    body: '{He} choose{s}. You can ask why.',
    paths: ['M5 21h9v10H5z', 'M34 21h9v10h-9z', 'M17 15h14v20H17z', 'M20.5 25.5l3 3 5-6'],
    fields: [
      {
        k: 'pick',
        label: '{He} picked',
        ph: 'Which one',
        type: 'text',
      },
      {
        k: 'why',
        label: 'Because',
        ph: '{His} reason, {his} words',
        type: 'text',
      },
    ],
  },
  {
    title: 'Make the final piece',
    short: 'Make',
    when: 'Weeks 3 to 6',
    body: 'One sitting a week. Photograph each one.',
    paths: [
      'M7 9h22v21H7z',
      'M13 30v11',
      'M23 30v11',
      'M29 40l12-12-4-4-12 12z',
      'M29 40l-5 1 1-5',
    ],
    sittings: true,
    up: {
      key: 'progress',
      label: 'Import the piece as it goes',
      hint: 'One photo per sitting so the progress is visible side by side.',
    },
    fields: [
      {
        k: 'photos',
        label: 'Photos kept where',
        ph: 'Album or folder',
        type: 'text',
      },
    ],
  },
  {
    title: 'Submit it',
    short: 'Submit',
    when: 'Deadline week',
    body: 'Form in, piece delivered, confirmation saved.',
    paths: ['M7 17h34v22H7z', 'M7 17l17 13 17-13', 'M24 4v8', 'M21 9l3 3 3-3'],
    up: {
      key: 'entry',
      label: 'Import the final entry',
      hint: 'The version that was actually submitted. Keep this one.',
    },
    fields: [
      {
        k: 'subdate',
        label: 'Submitted on',
        type: 'date',
      },
      {
        k: 'conf',
        label: 'Confirmation',
        ph: 'Reference or receipt',
        type: 'text',
      },
    ],
  },
  {
    title: 'Turn up on the day',
    short: 'Show',
    when: 'Competition day',
    body: '{He} hand{s} it over and answers the questions.',
    paths: [
      'M9 8h22v18H9z',
      'M15 26v13',
      'M25 26v13',
      'M15 33h10',
      'M40 13a3 3 0 100 6 3 3 0 100-6',
      'M40 20v8',
      'M36 39l4-11 4 11',
    ],
    fields: [
      {
        k: 'asked',
        label: 'A question {he} {was} asked',
        ph: 'One of them',
        type: 'text',
      },
      {
        k: 'answer',
        label: 'What {he} said back',
        ph: 'Short',
        type: 'text',
      },
    ],
  },
  {
    title: 'Log the result',
    short: 'Result',
    when: 'When it is announced',
    body: 'Whatever came back, written down.',
    paths: [
      'M8 40h32',
      'M13 40V26h7v14z',
      'M22.5 40V16h7v24z',
      'M32 40V30h7v10z',
      'M24 8l1.8 3.8 4.2.6-3 3 .7 4.2-3.7-2-3.7 2 .7-4.2-3-3 4.2-.6z',
    ],
    fields: [
      {
        k: 'result',
        label: 'Result',
        ph: 'Placed, shortlisted, shown, no result',
        type: 'text',
      },
      {
        k: 'feedback',
        label: 'Feedback {he} {was} given',
        ph: 'From a judge, teacher or visitor',
        type: 'text',
      },
    ],
  },
  {
    title: 'Log what {he} would change',
    short: 'Review',
    when: 'The day after',
    body: 'One line from {him} on what {he} would change.',
    paths: ['M13 10h22v31H13z', 'M20 7h8v5h-8z', 'M19 21h10', 'M19 29l3 3 7-7'],
    fields: [
      {
        k: 'change',
        label: '{His} one line',
        ph: 'What {he} would do differently',
        type: 'note',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Fallback plan — used when the Ask step's free-text answer matches none of
// the 9 interest categories above. Ported from the reference design's own
// `GENERIC(I)` template, which builds a plan from whichever interest label
// the parent typed rather than a fixed category.
// ---------------------------------------------------------------------------

const mk = {
  count: (k: string, label: string, target: number, ph?: string, stepBy?: number): PlanField => ({
    k,
    kind: 'count',
    label,
    target,
    ph: ph ?? 'Log one',
    stepBy,
  }),
  num: (k: string, label: string): PlanField => ({ k, kind: 'num', label }),
  text: (k: string, label: string, ph?: string): PlanField => ({ k, kind: 'text', label, ph }),
  area: (k: string, label: string, ph?: string): PlanField => ({ k, kind: 'area', label, ph }),
  date: (k: string, label: string): PlanField => ({ k, kind: 'date', label }),
  photo: (k: string, label: string): PlanField => ({ k, kind: 'photo', label }),
};

const taught = (who: string): PlanField[] => [
  mk.text('who', 'Who {he} taught', who),
  mk.count('mins', 'Minutes taught alone', 15, 'Add 5 min', 5),
  mk.area('after', 'What they could do afterwards', 'One line'),
];

/** Builds a plan on the fly from whatever interest the parent typed, when it
 * matched none of the 9 fixed categories in PLANS. */
export function genericPlan(interest: Interest): Plan {
  return {
    metric: 'Finished pieces of work',
    goals: [
      `By day 30: {he} {does} ${interest.label} without being reminded and one finished piece has been seen by strangers.`,
      `By day 60: {he} {has} hit a deadline {he} set {himself}, taught it to someone younger, and met an adult who does it seriously.`,
      `By day 90: {he} {has} ${interest.win}.`,
    ],
    acts: [
      {
        n: '01',
        time: '10 min daily',
        title: 'The same ten minutes',
        award: 'Streak keeper',
        objective: '20 sessions inside 30 days, logged here by {him}.',
        apply: 'Same corner, same time. Nothing new to buy.',
        do: [
          mk.count('sessions', 'Sessions logged', 20, 'Log today'),
          mk.num('metricBase', 'Finished pieces so far'),
        ],
      },
      {
        n: '02',
        time: 'Once a week',
        title: 'One question {he} chase{s}',
        award: 'First answer',
        objective: '1 question answered in 3 sentences {he} wrote {himself}.',
        apply: `{He} ask{s} a working ${interest.maker} the same question and reports back.`,
        do: [
          mk.text('q', '{His} question', 'One line'),
          mk.area('ans', '{His} answer, three sentences', 'Typed by {him}'),
          mk.text('check', `What the ${interest.maker} said`, 'Short version'),
        ],
      },
      {
        n: '03',
        time: 'By day 30',
        title: 'Finish one small thing',
        award: 'First finish',
        objective: '1 finished piece completed before day 30 and shown to 3 people.',
        apply: '{He} give{s} it to someone or puts it on public display.',
        do: [
          mk.photo('shot', 'Import the finished piece'),
          mk.date('done', 'Date {he} finished it'),
          mk.text('seen', 'Three people who saw it', 'Names'),
        ],
      },
      {
        n: '04',
        time: 'Twice a week',
        title: 'Twice the scope',
        award: 'Own deadline',
        objective: '1 piece at double the scope, delivered on the date {he} named.',
        apply: '{He} tell{s} someone outside the house {his} finish date before {he} start{s}.',
        do: [
          mk.text('scope', 'What {he} {is} making', 'One line'),
          mk.date('due', 'The date {he} named'),
          mk.text('told', 'Who is expecting it', 'Name'),
        ],
      },
      {
        n: '05',
        time: 'One evening',
        title: 'Teach it to someone younger',
        award: 'First teacher',
        objective: '1 session taught alone, 15 minutes, and they can do it after.',
        apply: 'One younger child, no adult stepping in.',
        do: taught('Name and age'),
      },
      {
        n: '06',
        time: 'Once this month',
        title: 'Meet the real version',
        award: 'Field visit',
        objective: `1 visit to ${interest.place}, 2 questions asked, 1 contact named.`,
        apply: '{He} prepare{s} both questions beforehand and asks them {himself}.',
        do: [
          mk.text('place', 'Where {he} went', 'Name it'),
          mk.area('qs', 'The two questions', 'One per line'),
          mk.text('contact', 'Named contact', 'Who {he} can go back to'),
        ],
      },
      {
        n: '07',
        time: 'Two weeks',
        title: 'Solve someone’s problem',
        award: 'First request met',
        objective: '1 real request from outside the family, delivered inside 2 weeks.',
        apply: '{He} deliver{s} it, then asks what would make it better.',
        do: [
          mk.text('who', 'Who asked, and for what', 'One line'),
          mk.date('delivered', 'Delivered on'),
          mk.area('feedback', 'What they said', 'And what {he} changed'),
        ],
      },
      {
        n: '08',
        time: 'One afternoon',
        title: 'Show three, defend one',
        award: 'Portfolio of three',
        objective: '3 finished pieces shown, 1 defended out loud.',
        apply: `{He} present{s} them at ${interest.place} and takes the questions {himself}.`,
        do: [
          mk.photo('three', 'Import the three pieces'),
          mk.text('fav', 'The one {he} defend{s}', 'Which'),
          mk.area('why', 'Why that one', '{His} argument'),
        ],
      },
      {
        n: '09',
        time: 'By day 90',
        title: 'Set month four {himself}',
        award: 'Plan owner',
        objective: 'Month four written by {him} — what, by when, who sees it.',
        apply: '{He} book{s} the date and tells the audience. You only turn up.',
        do: [
          mk.area('what', 'What {he} will make', 'Written by {him}'),
          mk.date('by', 'By when'),
          mk.num('metricBest', 'Finished pieces now'),
        ],
      },
    ],
  };
}

/** Resolves the plan for a matched (or fallback) interest — the one lookup
 * point every caller should use instead of indexing PLANS directly. */
export function getPlan(interest: Interest): Plan {
  return PLANS[interest.key] ?? genericPlan(interest);
}

// ---------------------------------------------------------------------------
// The fixed 3-month structure every plan is split into for the Dashboard's
// month tabs — day ranges and names are the same regardless of interest.
// ---------------------------------------------------------------------------

export interface PlanMonth {
  key: string;
  kicker: string;
  name: string;
  days: string;
  goal: string;
  metric: string;
  acts: PlanActivity[];
}

const MONTH_META: Array<Pick<PlanMonth, 'key' | 'kicker' | 'name' | 'days'>> = [
  { key: 'm1', kicker: 'Month 1', name: 'Anchor', days: 'Days 1–30' },
  { key: 'm2', kicker: 'Month 2', name: 'Stretch', days: 'Days 31–60' },
  { key: 'm3', kicker: 'Month 3', name: 'Own it', days: 'Days 61–90' },
];

/** Splits a resolved Plan's flat 9-activity list into the 3 month tabs shown
 * on the Dashboard step. */
export function buildPlanMonths(plan: Plan): PlanMonth[] {
  return MONTH_META.map((m, mi) => ({
    ...m,
    goal: plan.goals[mi] ?? '',
    metric: plan.metric,
    acts: plan.acts.slice(mi * 3, mi * 3 + 3),
  }));
}
