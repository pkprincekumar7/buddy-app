// Named starting points (docs/web-ui-test-plan.md, section 5.3): each a full stub table, so a
// test says where it starts in one line (`api.use('childMidway')`) and changes only what its
// behaviour needs. Every route a page may call has an answer, writes included, so a request
// no scenario expects (a new endpoint) is what fails a test, not an incidental call.

import type { Stubs } from '../fixtures';
import { KidServer } from './kid';
import {
  CHILD_ID,
  aChild,
  aChildPresign,
  aDoneKidActivity,
  aJob,
  aKidActivity,
  aMe,
  aPersonality,
  aPersonalityNotStarted,
  aPhotoPresign,
  aProfile,
  aProgressOut,
  aStarted,
  aToken,
  aTranscript,
  aTransform,
  aWorldRun,
  anAccount,
  anAccountPage,
  anAllowedEmail,
  anAllowedEmailPage,
  anApkLink,
  anArea,
  anOnboarding,
  anOnboardingNotStarted,
  progressAll,
  progressThrough,
  someAreas,
  someKidQuests,
  someObservations,
  someObservationsNotStarted,
  somePowers,
  somePreferences,
  someWorlds,
} from './builders';

type Child = ReturnType<typeof aChild>;

/** A signed-in parent whose children are `children` (the first is the one under test). */
function parent(children: Child[], kid = aKidActivity()): Stubs {
  const first = children[0];
  const byId = (id: string | undefined): Child | undefined => children.find((c) => c.id === id);
  return {
    // auth
    'GET /auth/me': { body: aMe() },
    'POST /auth/refresh': { body: aToken() },
    'POST /auth/logout': { status: 204, body: null },
    'POST /auth/logout-all': { status: 204, body: null },
    'DELETE /auth/account': { status: 202, body: { status: 'deleting' } },
    // users
    'GET /users/{user_id}/profile': { body: aProfile() },
    'PATCH /users/{user_id}/profile': ({ body }) => ({
      body: aProfile(body as Partial<ReturnType<typeof aProfile>>),
    }),
    'GET /users/{user_id}/preferences': { body: somePreferences() },
    'PATCH /users/{user_id}/preferences': ({ body }) => ({
      body: somePreferences(body as Partial<ReturnType<typeof somePreferences>>),
    }),
    // children
    'GET /children': { body: children },
    // Kept, as the children service does: the chat then loads it (without it, a 404 sends
    // the page Home, which a fast test could miss and a slowed one, SLOWMO, sees).
    'POST /children': ({ body }) => {
      const child = aChild({
        ...(body as Partial<Child>),
        id: 'c-new',
        progress: progressThrough('profile'),
      });
      children.push(child);
      return { status: 201, body: child };
    },
    'GET /children/{id}': ({ params }) => {
      const child = byId(params['id']);
      return child
        ? { body: child }
        : { status: 404, body: { detail: { code: 'child_not_found', msg: 'Child not found' } } };
    },
    'PATCH /children/{id}': ({ params, body }) => ({
      body: { ...(byId(params['id']) ?? aChild()), ...(body as Partial<Child>) },
    }),
    'DELETE /children/{id}': { status: 204, body: null },
    'POST /children/{id}/avatar/presign': { body: aChildPresign() },
    'POST /children/{id}/connect/visit': { body: aProgressOut(first?.progress ?? progressAll) },
    // Child view's activity, changed by each event as the children service does.
    ...new KidServer(kid).stubs(),
    // onboarding
    'GET /children/{id}/onboarding': { body: anOnboarding() },
    'PUT /children/{id}/onboarding': ({ body }) => ({
      body: anOnboarding({
        answers: (body as { answers?: Record<string, string> })?.answers ?? {},
      }),
    }),
    // discover
    'GET /children/{id}/personality': { body: aPersonality() },
    'POST /children/{id}/personality/generation': { status: 202, body: aStarted() },
    'GET /children/{id}/personality/generation/{job_id}': {
      body: aJob('personality', 'completed'),
    },
    'GET /children/{id}/personality/powers': { body: somePowers() },
    'POST /children/{id}/personality/viewed': { body: aPersonality() },
    // grow
    'GET /children/{id}/growth-areas': { body: someAreas() },
    'PUT /children/{id}/growth-areas/{area_id}': ({ params, body }) => ({
      body: anArea({ ...(body as object), area_id: params['area_id'] ?? 'life_ambition' }),
    }),
    'POST /children/{id}/growth-areas/{area_id}/generation': { status: 202, body: aStarted() },
    'GET /children/{id}/growth-areas/{area_id}/generation/{job_id}': {
      body: aJob('parent_questions', 'completed'),
    },
    'GET /children/{id}/growth-areas/worlds': { body: someWorlds() },
    'POST /children/{id}/growth-areas/worlds/{world}/runs': ({ params, body }) => {
      const scores = (body as { scores?: number[] } | null)?.scores ?? [80, 80, 80];
      const total = Math.round(scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1));
      return { body: someWorlds({ [params['world'] ?? '0']: [{ ...aWorldRun(total), scores }] }) };
    },
    // transform
    'GET /children/{id}/transform': { body: aTransform() },
    'PATCH /children/{id}/transform': ({ body, count }) => ({
      body: aTransform({ ...(body as object), version: count + 1 }),
    }),
    'POST /children/{id}/transform/generation': { status: 202, body: aStarted() },
    'GET /children/{id}/transform/generation/{job_id}': { body: aJob('plan', 'completed') },
    'POST /children/{id}/transform/photos/presign': { body: aPhotoPresign() },
    'GET /children/{id}/transform/quests': { body: someKidQuests() },
    'PUT /children/{id}/transform/quests/current': ({ body }) => ({
      body: someKidQuests({ current: (body as { interest: 'drawing' }).interest }),
    }),
    'POST /children/{id}/transform/quests/log': { body: someKidQuests() },
    // release
    'GET /children/{id}/observations': { body: someObservations() },
    'PATCH /children/{id}/observations': { body: someObservations() },
    'POST /children/{id}/observations/generation': { status: 202, body: aStarted() },
    'GET /children/{id}/observations/generation/{job_id}': {
      body: aJob('observations', 'completed'),
    },
    // shared
    'POST /speech/transcriptions': { body: aTranscript() },
    'GET /downloads/apk': { body: anApkLink() },
  };
}

export const scenarios = {
  /** Signed in, no children yet: Home's empty state, Add Child. */
  newParent: (): Stubs => parent([]),

  /** One child, profile saved, the chat not finished. */
  childInSetup: (): Stubs => ({
    ...parent([aChild({ progress: progressThrough('profile') })]),
    'GET /children/{id}/onboarding': { body: anOnboardingNotStarted() },
    'GET /children/{id}/personality': { body: aPersonalityNotStarted() },
    'GET /children/{id}/observations': { body: someObservationsNotStarted() },
  }),

  /** The chat done, the personality ready; Grow and the circles after it locked. */
  childDiscovered: (): Stubs => ({
    ...parent([aChild({ progress: progressThrough('discover') })]),
    'GET /children/{id}/observations': { body: someObservationsNotStarted() },
  }),

  /** Discover and Grow done, Transform open with no plan yet. */
  childMidway: (): Stubs => ({
    ...parent(
      [aChild({ progress: progressThrough('grow') })],
      aKidActivity({
        stars: 7,
        circles_done: {
          discover: true,
          grow: false,
          transform: false,
          release: false,
          connect: false,
        },
        flipped_powers: [0, 1, 2, 3, 4, 5, 6],
        discover_badge: true,
      }),
    ),
    'GET /children/{id}/growth-areas': { body: someAreas([anArea()]) },
    'GET /children/{id}/observations': { body: someObservationsNotStarted() },
  }),

  /** Everything through Transform: a 90-day plan and a tracker. */
  childWithPlan: (): Stubs => ({
    ...parent([aChild({ progress: progressThrough('transform') })]),
    'GET /children/{id}/growth-areas': { body: someAreas([anArea()]) },
    'GET /children/{id}/transform': {
      body: aTransform({ ask: 'Help her finish what she starts', event_name: 'School fair' }),
    },
  }),

  /** All circles done, wins shown, moods and quests logged (the default). */
  everythingDone: (): Stubs => ({
    ...parent([aChild()], aDoneKidActivity()),
    'GET /children/{id}/growth-areas': { body: someAreas([anArea()]) },
    'GET /children/{id}/growth-areas/worlds': {
      body: someWorlds({ '0': [aWorldRun(90)], '1': [aWorldRun(60)] }),
    },
    'GET /children/{id}/transform/quests': {
      body: someKidQuests({ logs: { 'drawing:0': 1 }, last_logged: { 'drawing:0': '2026-11-14' } }),
    },
  }),

  /** Two children: Asha with everything done, Ben still in setup (the chat not finished). */
  twoChildren: (): Stubs =>
    parent([aChild(), aChild({ id: 'c-ben', name: 'Ben', progress: progressThrough('profile') })]),

  /** The 10-child limit. */
  tenChildren: (): Stubs =>
    parent(
      Array.from({ length: 10 }, (_, i) =>
        aChild({ id: i === 0 ? CHILD_ID : `c-${i}`, name: `Child ${i + 1}` }),
      ),
    ),

  /** An admin: only the admin page. */
  admin: (): Stubs => ({
    ...parent([]),
    'GET /auth/me': { body: aMe({ role: 'admin', email: 'admin@example.test' }) },
    'GET /auth/allowed-emails': { body: anAllowedEmailPage() },
    'POST /auth/allowed-emails': { status: 201, body: anAllowedEmail({ key: 'k-new' }) },
    'POST /auth/allowed-emails/search': { body: anAllowedEmail() },
    'DELETE /auth/allowed-emails/{key}': { status: 204, body: null },
    'GET /auth/accounts': { body: anAccountPage() },
    'POST /auth/accounts/search': { body: anAccount() },
    'POST /auth/accounts/{id}/lock': ({ params }) => ({
      body: { id: params['id'] ?? '', locked: true },
    }),
    'POST /auth/accounts/{id}/unlock': ({ params }) => ({
      body: { id: params['id'] ?? '', locked: false },
    }),
    'PATCH /auth/accounts/{id}/role': ({ params, body }) => ({
      body: { id: params['id'] ?? '', role: (body as { role: 'admin' | 'parent' }).role },
    }),
    'GET /users/profiles': { body: { items: [] } },
  }),

  /** Signed out: /auth/me and the refresh both 401. */
  signedOut: (): Stubs => ({
    'GET /auth/me': { status: 401, body: { detail: 'Not authenticated' } },
    'POST /auth/refresh': { status: 401, body: { detail: 'Not authenticated' } },
    'POST /auth/logout': { status: 204, body: null },
    'POST /auth/login': { body: aToken() },
    'POST /auth/register': { status: 201, body: aToken() },
    'POST /auth/google': { body: aToken() },
  }),
} satisfies Record<string, () => Stubs>;

export type ScenarioName = keyof typeof scenarios;

/** An account to use in admin tests. */
export { anAccount };
