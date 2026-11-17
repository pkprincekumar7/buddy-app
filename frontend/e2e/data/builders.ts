// Typed builders for every response the app reads (docs/web-ui-test-plan.md, section 5.2).
// Each returns safe defaults for the made-up test family (Test Parent, Asha) and takes
// overrides. Never copy real responses: they carry real children's details.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  AuthSchemas,
  ChildrenSchemas,
  DiscoverSchemas,
  GrowSchemas,
  OnboardingSchemas,
  ReleaseSchemas,
  SharedSchemas,
  TransformSchemas,
  UsersSchemas,
} from './routes';

type S<C> = C extends { schemas: infer X } ? X : never;
type Auth = S<AuthSchemas>;
type Children = S<ChildrenSchemas>;
type Discover = S<DiscoverSchemas>;
type Grow = S<GrowSchemas>;
type Onboarding = S<OnboardingSchemas>;
type Release = S<ReleaseSchemas>;
type Shared = S<SharedSchemas>;
type Transform = S<TransformSchemas>;
type Users = S<UsersSchemas>;

export const USER_ID = 'u-test';
export const CHILD_ID = 'c-test';
export const CHILD_NAME = 'Asha';
/** The day the tests run "on" when a test fixes the clock; stored dates are relative to it. */
export const TODAY = '2026-11-15';
const CREATED = '2026-01-01T00:00:00Z';

const repo = (path: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../..', path), 'utf8')) as unknown;

// -- auth -----------------------------------------------------------------------------

export const aMe = (over: Partial<Auth['MeResponse']> = {}): Auth['MeResponse'] => ({
  id: USER_ID,
  email: 'parent@example.test',
  role: 'parent',
  auth_provider: 'password',
  location: 'IN',
  created_at: CREATED,
  ...over,
});

export const aToken = (): Auth['TokenResponse'] => ({ status: 'ok' });

export const anAccount = (over: Partial<Auth['Account']> = {}): Auth['Account'] => ({
  id: 'u-other',
  email: 'someone@example.test',
  role: 'parent',
  auth_provider: 'password',
  location: 'IN',
  locked: false,
  deleting: false,
  created_at: CREATED,
  ...over,
});

export const anAccountPage = (items = [anAccount()]): Auth['AccountPage'] => ({
  items,
  total: items.length,
  skip: 0,
  limit: 50,
});

export const anAllowedEmail = (over: Partial<Auth['AllowedEmail']> = {}): Auth['AllowedEmail'] => ({
  key: 'k-1',
  email_hint: 'f***@example.test',
  added_by: 'admin@example.test',
  created_at: CREATED,
  ...over,
});

export const anAllowedEmailPage = (items = [anAllowedEmail()]): Auth['AllowedEmailPage'] => ({
  items,
  total: items.length,
  skip: 0,
  limit: 50,
});

// -- users ----------------------------------------------------------------------------

export const aProfile = (over: Partial<Users['Profile']> = {}): Users['Profile'] => ({
  id: USER_ID,
  first_name: 'Test',
  middle_name: null,
  last_name: 'Parent',
  address_line_one: null,
  address_line_two: null,
  address_line_three: null,
  location: 'IN',
  created_at: CREATED,
  updated_at: CREATED,
  ...over,
});

export const somePreferences = (
  over: Partial<Users['Preferences']> = {},
): Users['Preferences'] => ({ tts_enabled: false, ...over });

// -- children -------------------------------------------------------------------------

type Progress = Children['Progress'];
export const progressNone: Progress = {
  profile: false,
  conversation: false,
  discover: false,
  grow: false,
  transform: false,
  release: false,
  connect: false,
};
export const progressAll: Progress = {
  profile: true,
  conversation: true,
  discover: true,
  grow: true,
  transform: true,
  release: true,
  connect: true,
};
/** Progress through `upTo` (in the circles' order), nothing after. */
export function progressThrough(upTo: keyof Progress | null): Progress {
  const order: (keyof Progress)[] = [
    'profile',
    'conversation',
    'discover',
    'grow',
    'transform',
    'release',
    'connect',
  ];
  const end = upTo ? order.indexOf(upTo) : -1;
  return Object.fromEntries(order.map((k, i) => [k, i <= end])) as Progress;
}

export const aChild = (over: Partial<Children['Child']> = {}): Children['Child'] => ({
  id: CHILD_ID,
  name: CHILD_NAME,
  age: 9,
  gender: 'Female', // as the profile form sends it
  school: 'Test School',
  avatar_id: 'avatar_1',
  avatar_url: null,
  progress: progressAll,
  created_at: CREATED,
  updated_at: CREATED,
  ...over,
});

export const kidCirclesNone: Children['KidCircles'] = {
  discover: false,
  grow: false,
  transform: false,
  release: false,
  connect: false,
};

export const aKidActivity = (
  over: Partial<Children['KidActivity']> = {},
): Children['KidActivity'] => ({
  stars: 0,
  circles_done: kidCirclesNone,
  flipped_powers: [],
  discover_badge: false,
  tried_today: [],
  best_times: {},
  moods: {},
  shown: {},
  ...over,
});

export const aDoneKidActivity = (): Children['KidActivity'] =>
  aKidActivity({
    stars: 12,
    circles_done: { discover: true, grow: true, transform: true, release: true, connect: false },
    flipped_powers: [0, 1, 2, 3, 4, 5, 6],
    discover_badge: true,
    best_times: { focus: 9, order: 7 },
    moods: { [TODAY]: { mood: 'good', note: 'Played outside' } },
  });

export const aChildPresign = (): Children['PresignOut'] => ({
  upload_url: 'https://uploads.example.test/avatars',
  upload_fields: { key: 'avatars/c-test/new.png' },
  avatar_key: 'avatars/c-test/new.png',
  avatar_url: 'https://uploads.example.test/avatars/c-test/new.png',
});

export const aProgressOut = (progress = progressAll): Children['ProgressOut'] => ({ progress });

// -- onboarding -----------------------------------------------------------------------

export const anOnboarding = (
  over: Partial<Onboarding['Onboarding']> = {},
): Onboarding['Onboarding'] => ({
  status: 'completed',
  child_name: CHILD_NAME,
  answers: {
    strengths: ['Curious', 'Kind'],
    hobbies: ['Drawing', 'Football'],
    thinking_pattern: 'Asks why',
    communication_style: 'Chatty',
    energy_level: 'High',
    social_behaviour: 'Makes friends easily',
    emotional_behaviour: 'Calm',
  },
  completed_at: CREATED,
  ...over,
});

export const anOnboardingNotStarted = (): Onboarding['Onboarding'] =>
  anOnboarding({ status: 'not_started', answers: {}, completed_at: null });

// -- discover -------------------------------------------------------------------------

/** The web app's own view model, as discover's tests store it (made-up child "Aarav"). */
const viewModels = repo('backend/discover/tests/fixtures/view_models.json') as Record<
  string,
  unknown
>[];
function renamed<T>(value: T, name: string): T {
  return JSON.parse(JSON.stringify(value).replaceAll('Aarav', name)) as T;
}

export const aPersonality = (
  over: Partial<Discover['Personality']> = {},
): Discover['Personality'] => ({
  status: 'ready',
  view_model: renamed(viewModels[0] ?? {}, CHILD_NAME),
  job_id: null,
  finalised_at: CREATED,
  viewed_at: CREATED,
  ...over,
});

export const aPersonalityNotStarted = (): Discover['Personality'] =>
  aPersonality({ status: 'not_started', view_model: null, finalised_at: null, viewed_at: null });

const GAMES = ['focus', 'curious', 'order', 'draw', 'climb', 'voice', 'energy'] as const;
export const somePowers = (): Discover['Powers'] => ({
  style: 'Thinker',
  style_line: `${CHILD_NAME} notices the small things.`,
  powers: [
    'Focus',
    'Curiosity',
    'Order',
    'Imagination',
    'Determination',
    'Brave voice',
    'Energy',
  ].map((name, i) => ({
    name,
    game: GAMES[i] ?? 'focus',
    level: 3 + (i % 3), // 3 to 5, as discover gives them
    line: `${CHILD_NAME} shows ${name.toLowerCase()} every day.`,
    try_this: `Try a ${name.toLowerCase()} game together.`,
  })),
});

// -- jobs (every generation: discover, grow, transform, release) ---------------------------

export const aStarted = (jobId = 'job-1'): Discover['Started'] => ({
  job_id: jobId,
  status: 'pending',
});

export function aJob<K extends string>(
  kind: K,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  jobId = 'job-1',
): {
  job_id: string;
  kind: K;
  status: typeof status;
  error: string | null;
  created_at: string;
  completed_at: string | null;
} {
  return {
    job_id: jobId,
    kind,
    status,
    error: status === 'failed' ? 'The generation failed' : null,
    created_at: CREATED,
    completed_at: status === 'completed' || status === 'failed' ? CREATED : null,
  };
}

// -- grow -----------------------------------------------------------------------------

/** The worlds and bands, from the grow service's own content (no child's data in it). */
const worldsCatalog = repo('backend/grow/app/worlds.json') as Pick<
  Grow['Worlds'],
  'worlds' | 'bands'
>;

export const someWorlds = (runs: Grow['Worlds']['runs'] = {}): Grow['Worlds'] => ({
  worlds: worldsCatalog.worlds,
  bands: worldsCatalog.bands,
  runs,
});

export const aWorldRun = (total = 80, at = `${TODAY}T10:00:00Z`): Grow['WorldRun'] => ({
  total,
  scores: [total, total, total],
  at,
});

/** Grow's parent questions as the service stores them (its tests' made-up sample). */
const growQuestions = repo('backend/grow/tests/fixtures/normalised.json') as unknown[];

export const anArea = (over: Partial<Grow['Area']> = {}): Grow['Area'] => ({
  area_id: 'life_ambition',
  area_name: 'Life Ambition',
  status: 'completed',
  step: null,
  parent_questions: { questions: renamed(growQuestions[0] ?? [], CHILD_NAME) },
  answers: {},
  child_activity: null,
  recommendations: null,
  ai_three_month_recommendations: null,
  recommendations_run_at: null,
  recommendations_current: false,
  feedback: null,
  generating: [],
  completed_at: CREATED,
  updated_at: CREATED,
  ...over,
});

export const someAreas = (areas: Grow['Area'][] = []): Grow['Areas'] => ({ areas });

// -- transform ------------------------------------------------------------------------

export const aTransform = (over: Partial<Transform['Transform']> = {}): Transform['Transform'] => ({
  version: 1,
  areas: [],
  ask: null,
  plan: null,
  track_steps: null,
  applied: {},
  act_inputs: {},
  act_counts: {},
  track_done: {},
  track_inputs: {},
  track_sittings: {},
  feedback: {},
  event_name: null,
  event_date: null,
  event_set: false,
  photos: {},
  generating: [],
  completed_at: null,
  ...over,
});

export const someKidQuests = (
  over: Partial<Transform['KidQuests']> = {},
): Transform['KidQuests'] => ({
  default_interest: null,
  interests: ['drawing'],
  current: 'drawing',
  logs: {},
  last_logged: {},
  logged_today: [],
  catalog: [
    {
      key: 'drawing',
      label: 'Drawing',
      quests: [
        { target: 1, title: 'Draw your street', how: 'Look out of the window.' },
        { target: 3, title: 'Draw a pet', how: 'Any pet will do.' },
        { target: 5, title: 'Draw a map', how: 'Your way to school.' },
      ],
    },
    {
      key: 'football',
      label: 'Football',
      quests: [{ target: 1, title: 'Ten kick-ups', how: 'Count out loud.' }],
    },
  ],
  ...over,
});

export const aPhotoPresign = (): Transform['PresignOut'] => ({
  upload_url: 'https://uploads.example.test/photos',
  upload_fields: { key: 'photos/c-test/1.jpg' },
  photo_key: 'photos/c-test/1.jpg',
  photo_url: 'https://uploads.example.test/photos/c-test/1.jpg',
});

// -- release --------------------------------------------------------------------------

/** Observations as the release service normalises them (its tests' made-up sample). */
const releaseCases = (
  repo('backend/release/tests/fixtures/normalised.json') as {
    cases: { items: Release['ObservationItem'][] }[];
  }
).cases;

export const someObservations = (
  over: Partial<Release['Observations']> = {},
): Release['Observations'] => ({
  status: 'ready',
  source: 'onboarding',
  items: releaseCases[0]?.items.slice(0, 3) ?? [],
  watching: ['Sleep', 'Screen time'],
  span: '4 weeks',
  started_at: CREATED,
  job_id: null,
  completed_at: CREATED,
  ...over,
});

export const someObservationsNotStarted = (): Release['Observations'] =>
  someObservations({ status: 'not_started', items: [], started_at: null, completed_at: null });

// -- shared ---------------------------------------------------------------------------

export const aTranscript = (transcript = 'She loves drawing maps'): Shared['Transcript'] => ({
  transcript,
});

export const anApkLink = (): Shared['ApkLink'] => ({
  url: 'https://downloads.example.test/superpower.apk',
  filename: 'superpower.apk',
  expires_in: 300,
});
