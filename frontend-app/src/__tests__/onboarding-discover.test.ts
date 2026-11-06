import AsyncStorage from '@react-native-async-storage/async-storage';
import { discover, settlePersonality, viewModelOf } from '@/api/discover';
import { answersFrom, onboarding } from '@/api/onboarding';

jest.mock('@/lib/env', () => ({ env: { API_URL: 'https://api.test' } }));

type Sent = { method: string; path: string; body: unknown };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers each call with the next of `answers` (keyed by "METHOD path"), and keeps what was sent. */
function network(answers: Record<string, Response | Response[]>): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      const path = new URL(request.url).pathname;
      const text = await request.text();
      sent.push({
        method: request.method,
        path,
        body: text ? JSON.parse(text) : undefined,
      });
      const key = `${request.method} ${path}`;
      const answer = answers[key];
      const next = Array.isArray(answer) ? answer.shift() : answer;
      if (!next) throw new Error(`unexpected ${key}`);
      return next.clone();
    },
  ) as typeof fetch;
  return sent;
}

const ID = 'c0ffee00-0000-4000-8000-000000000001';
const BASE = `/api/v1/children/${ID}`;
const ANSWERS = {
  strengths: ['curious', 'kind'],
  hobbies: ['drawing'],
  thinking_pattern: 'Asks why',
  communication_style: 'Chatty',
  energy_level: 'High',
  social_behaviour: 'Warm',
  emotional_behaviour: 'Calm',
};
const personality = (status: string, extra: object = {}) =>
  json(200, {
    status,
    view_model: null,
    job_id: null,
    finalised_at: null,
    viewed_at: null,
    ...extra,
  });
const VM = {
  type: 'Thinker',
  scores: { Thinker: 100 },
  profile: { name: 'x' },
};

beforeEach(async () => {
  await AsyncStorage.setItem('superpower:access_token', 'parent-token');
});

describe('the onboarding answers (build plan 7.5)', () => {
  it('are taken from the chat only when all seven are there', () => {
    expect(
      answersFrom({
        ...ANSWERS,
        strengths: ' curious , kind ,',
        name: 'Aarav', // the child's own fields aren't answers
      }),
    ).toEqual(ANSWERS);
    expect(answersFrom({ ...ANSWERS, energy_level: '  ' })).toBeNull();
    expect(answersFrom({ ...ANSWERS, hobbies: [] })).toBeNull();
  });

  it('are saved in one PUT with only the seven fields', async () => {
    const sent = network({
      [`PUT ${BASE}/onboarding`]: json(201, {
        status: 'completed',
        child_name: 'Aarav',
        answers: ANSWERS,
        completed_at: '2026-10-31T00:00:00Z',
      }),
    });
    const saved = await onboarding.save(ID, ANSWERS);
    expect(saved.status).toBe('completed');
    expect(sent).toEqual([
      { method: 'PUT', path: `${BASE}/onboarding`, body: ANSWERS },
    ]);
  });

  it('resume from the child and the saved answers, or the child alone', async () => {
    // The locked read is logged; keep it out of the test output.
    jest.spyOn(console, 'warn').mockImplementationOnce(() => {});
    const child = json(200, {
      id: ID,
      name: 'Aarav',
      age: 9,
      gender: 'Male',
      school: null,
    });
    network({
      [`GET ${BASE}`]: [child, child],
      [`GET ${BASE}/onboarding`]: [
        json(200, {
          status: 'completed',
          child_name: 'Aarav',
          answers: ANSWERS,
          completed_at: 'x',
        }),
        json(403, { detail: { code: 'circle_locked', msg: 'Locked.' } }),
      ],
    });
    expect(await onboarding.draft(ID)).toEqual({
      name: 'Aarav',
      age: '9',
      gender: 'Male',
      ...ANSWERS,
    });
    expect(await onboarding.draft(ID)).toEqual({
      name: 'Aarav',
      age: '9',
      gender: 'Male',
    });
  });
});

describe('the personality (build plan 7.5)', () => {
  it('is started on not_started, then waited for by polling its job', async () => {
    const sent = network({
      [`GET ${BASE}/personality`]: [
        personality('not_started'),
        personality('generating', { job_id: 'j1' }),
        personality('ready', { view_model: VM }),
      ],
      [`POST ${BASE}/personality/generation`]: json(202, {
        job_id: 'j1',
        status: 'pending',
      }),
      [`GET ${BASE}/personality/generation/j1`]: [
        json(200, { job_id: 'j1', status: 'processing' }),
        json(200, { job_id: 'j1', status: 'completed' }),
      ],
    });
    const settled = await settlePersonality(ID, { intervalMs: 1 });
    expect(viewModelOf(settled)).toEqual(VM);
    expect(sent.map(s => `${s.method} ${s.path.replace(BASE, '')}`)).toEqual([
      'GET /personality',
      'POST /personality/generation',
      'GET /personality',
      'GET /personality/generation/j1',
      'GET /personality/generation/j1',
      'GET /personality',
    ]);
    expect(sent[1]?.body).toBeUndefined(); // no prompt, no write-back
  });

  it('is not restarted after a failure unless it is a retry', async () => {
    network({
      [`GET ${BASE}/personality`]: [
        personality('failed'),
        personality('failed'),
        personality('ready', { view_model: VM }),
      ],
      [`POST ${BASE}/personality/generation`]: json(409, {
        detail: { code: 'already_generated', msg: 'Done.' },
      }),
    });
    expect((await settlePersonality(ID)).status).toBe('failed');
    // A retry starts one; already_generated (finished meanwhile) just reads it.
    expect((await settlePersonality(ID, { retry: true })).status).toBe('ready');
  });

  it('stops waiting when the page goes away', async () => {
    network({
      [`GET ${BASE}/personality`]: personality('generating'),
    });
    const controller = new AbortController();
    const waiting = settlePersonality(ID, {
      intervalMs: 60_000,
      signal: controller.signal,
    });
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('records the reveal with viewed, and has no view model until ready', async () => {
    const sent = network({
      [`POST ${BASE}/personality/viewed`]: personality('ready', {
        view_model: VM,
        viewed_at: 'x',
      }),
    });
    await discover.viewed(ID);
    expect(sent.map(s => `${s.method} ${s.path}`)).toEqual([
      `POST ${BASE}/personality/viewed`,
    ]);
    expect(viewModelOf(null)).toBeNull();
    expect(
      viewModelOf({
        status: 'generating',
        view_model: null,
        job_id: 'j',
        finalised_at: null,
        viewed_at: null,
      }),
    ).toBeNull();
  });
});
