import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  areaSave,
  grow,
  runGrowGeneration,
  type GrowthAreaDoc,
} from '@/api/grow';

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
const AREA = `/api/v1/children/${ID}/growth-areas/self_care`;
const STORED: GrowthAreaDoc = {
  area_id: 'self_care',
  area_name: 'Self care',
  status: 'in_progress',
  step: 'activity_summary',
  parent_questions: { questions: [{ id: 'self_care_gq1' }] },
  child_rounds: null,
  answers: { self_care_gq1: 'Often' },
  child_activity: { selections: ['a'] },
  recommendations: null,
  ai_three_month_recommendations: null,
  feedback: 'Nice',
  generating: [],
  completed_at: null,
  updated_at: '2026-10-31T00:00:00Z',
};
const job = (status: string) =>
  json(200, { job_id: 'j1', kind: 'child_rounds', status });

beforeEach(async () => {
  await AsyncStorage.setItem('superpower:access_token', 'parent-token');
});

describe('the growth-area saves (build plan 7.6)', () => {
  it('carry every stored field, since a save replaces them all', () => {
    expect(
      areaSave(STORED, 'Self care', { child_activity: { selections: ['b'] } }),
    ).toEqual({
      area_name: 'Self care',
      status: 'in_progress',
      step: 'activity_summary',
      answers: { self_care_gq1: 'Often' },
      child_activity: { selections: ['b'] },
      recommendations: null,
      feedback: 'Nice', // kept, not cleared
    });
    // No generated field is sent: grow writes those itself.
    expect(Object.keys(areaSave(STORED, 'x', {}))).not.toContain(
      'parent_questions',
    );
  });

  it('keep a completed area completed, and start a new one in progress', () => {
    const done = { ...STORED, status: 'completed' as const };
    expect(areaSave(done, 'Self care', { status: 'in_progress' }).status).toBe(
      'completed',
    );
    expect(areaSave(undefined, 'Self care', { answers: {} })).toMatchObject({
      area_name: 'Self care',
      status: 'in_progress',
      answers: {},
    });
  });

  it('are PUT by area id, and the list is the areas', async () => {
    const sent = network({
      [`PUT ${AREA}`]: json(200, STORED),
      [`GET /api/v1/children/${ID}/growth-areas`]: json(200, {
        areas: [STORED],
      }),
    });
    await grow.save(ID, 'self_care', areaSave(STORED, 'Self care', {}));
    expect(await grow.list(ID)).toEqual([STORED]);
    expect(sent.map(s => `${s.method} ${s.path}`)).toEqual([
      `PUT ${AREA}`,
      `GET /api/v1/children/${ID}/growth-areas`,
    ]);
  });
});

describe('a growth-area generation (build plan 7.6)', () => {
  it('asks for a kind (with the name for a new area), then polls its job', async () => {
    const sent = network({
      [`POST ${AREA}/generation`]: json(202, {
        job_id: 'j1',
        status: 'pending',
      }),
      [`GET ${AREA}/generation/j1`]: [job('processing'), job('completed')],
    });
    expect(
      await runGrowGeneration(ID, 'self_care', 'parent_questions', {
        areaName: 'Self care',
        intervalMs: 1,
      }),
    ).toBe('completed');
    expect(sent[0]?.body).toEqual({
      kind: 'parent_questions',
      area_name: 'Self care',
    }); // no prompt, no write-back
    expect(sent.map(s => s.method)).toEqual(['POST', 'GET', 'GET']);
  });

  it('reports a failed job, and counts an existing part as done', async () => {
    const sent = network({
      [`POST ${AREA}/generation`]: [
        json(200, { job_id: 'j1', status: 'processing' }),
        json(409, { detail: { code: 'already_generated', msg: 'Done.' } }),
      ],
      [`GET ${AREA}/generation/j1`]: job('failed'),
    });
    expect(
      await runGrowGeneration(ID, 'self_care', 'child_rounds', {
        intervalMs: 1,
      }),
    ).toBe('failed');
    expect(sent[0]?.body).toEqual({ kind: 'child_rounds' });
    expect(
      await runGrowGeneration(ID, 'self_care', 'child_rounds', {
        intervalMs: 1,
      }),
    ).toBe('completed');
  });

  it('passes other refusals on, such as llm_limit', async () => {
    network({
      [`POST ${AREA}/generation`]: json(429, {
        detail: { code: 'llm_limit', msg: 'Later.' },
      }),
    });
    await expect(
      runGrowGeneration(ID, 'self_care', 'recommendations'),
    ).rejects.toMatchObject({ status: 429, code: 'llm_limit' });
  });
});
