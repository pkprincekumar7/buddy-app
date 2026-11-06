import AsyncStorage from '@react-native-async-storage/async-storage';
import { children } from '@/api/children';
import { release, runObservationsGeneration } from '@/api/release';
import { runTransformGeneration, transform } from '@/api/transform';

jest.mock('@/lib/env', () => ({ env: { API_URL: 'https://api.test' } }));

type Sent = { method: string; url: string; type: string | null; body: unknown };

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
      const url = new URL(request.url);
      const type = request.headers.get('content-type');
      const text = await request.text();
      sent.push({
        method: request.method,
        url: url.origin === 'https://api.test' ? url.pathname : request.url,
        type,
        body: type?.includes('json') && text ? JSON.parse(text) : text,
      });
      const key = `${request.method} ${url.pathname}`;
      const answer = answers[key];
      const next = Array.isArray(answer) ? answer.shift() : answer;
      if (!next) throw new Error(`unexpected ${key}`);
      return next.clone();
    },
  ) as typeof fetch;
  return sent;
}

const ID = 'c0ffee00-0000-4000-8000-000000000001';
const T = `/api/v1/children/${ID}/transform`;
const O = `/api/v1/children/${ID}/observations`;
const job = (status: string) => json(200, { job_id: 'j1', status });

beforeEach(async () => {
  await AsyncStorage.setItem('superpower:access_token', 'parent-token');
});

describe('transform (build plan 7.7)', () => {
  it('patches only the fields sent, and photos by key', async () => {
    const sent = network({ [`PATCH ${T}`]: json(200, {}) });
    await transform.patch(ID, {
      ask: 'Help him handle frustration calmly',
      photos: { 'act:week-1': ['uploads/in/x/ninety-day-plan/a.jpg'] },
    });
    expect(sent[0]?.body).toEqual({
      clear_track_steps: false,
      ask: 'Help him handle frustration calmly',
      photos: { 'act:week-1': ['uploads/in/x/ninety-day-plan/a.jpg'] },
    });
  });

  it('uploads a plan photo to S3 and returns its key and URL to show', async () => {
    const sent = network({
      [`POST ${T}/photos/presign`]: json(200, {
        upload_url: 'https://s3.test/bucket',
        upload_fields: { key: 'uploads/in/x/ninety-day-plan/b.png' },
        photo_key: 'uploads/in/x/ninety-day-plan/b.png',
        photo_url: 'https://s3.test/get',
      }),
      'POST /bucket': new Response(null, { status: 204 }),
    });
    const photo = await transform.uploadPhoto(
      ID,
      'act:week-1',
      new Blob(['png'], { type: 'image/png', lastModified: 0 }),
      'image/png',
    );
    expect(photo).toEqual({
      key: 'uploads/in/x/ninety-day-plan/b.png',
      url: 'https://s3.test/get',
    });
    expect(sent[0]?.body).toEqual({
      field_key: 'act:week-1',
      content_type: 'image/png',
    });
    expect([sent[1]?.method, sent[1]?.url]).toEqual([
      'POST',
      'https://s3.test/bucket',
    ]);
    expect(sent[1]?.type).toMatch(/^multipart\/form-data/); // a form upload (APP-07)
    expect(String(sent[1]?.body)).toContain(
      'uploads/in/x/ninety-day-plan/b.png',
    );
    expect(sent).toHaveLength(2); // the save is the caller's PATCH, with the other keys
  });

  it('generates by kind (an area for the Life Pathway), polling the job', async () => {
    const sent = network({
      [`POST ${T}/generation`]: [
        json(202, { job_id: 'j1', status: 'pending' }),
        json(202, { job_id: 'j1', status: 'pending' }),
      ],
      [`GET ${T}/generation/j1`]: [
        job('processing'),
        job('completed'),
        job('failed'),
      ],
    });
    expect(
      await runTransformGeneration(ID, 'life_pathway', {
        areaId: 'self_care',
        intervalMs: 1,
      }),
    ).toBe('completed');
    expect(await runTransformGeneration(ID, 'plan', { intervalMs: 1 })).toBe(
      'failed',
    );
    expect(sent[0]?.body).toEqual({
      kind: 'life_pathway',
      area_id: 'self_care',
    }); // no prompt, no write-back
    expect(sent[3]?.body).toEqual({ kind: 'plan' });
  });
});

describe('release and connect (build plan 7.7)', () => {
  it('saves only what is watched and for how long', async () => {
    const sent = network({ [`PATCH ${O}`]: json(200, {}) });
    await release.watch(ID, ['obs-1', 'obs-2'], '2 weeks');
    expect(sent[0]?.body).toEqual({
      watching: ['obs-1', 'obs-2'],
      span: '2 weeks',
    }); // no items, source or started_at: release sets those
  });

  it('generates the patterns with no body, polling the job', async () => {
    const sent = network({
      [`POST ${O}/generation`]: json(200, {
        job_id: 'j1',
        status: 'processing',
      }),
      [`GET ${O}/generation/j1`]: job('completed'),
    });
    expect(await runObservationsGeneration(ID, { intervalMs: 1 })).toBe(
      'completed',
    );
    expect(sent[0]?.body).toBe('');
  });

  it('records the Connect visit and returns the progress', async () => {
    const progress = {
      profile: true,
      conversation: true,
      discover: true,
      grow: true,
      transform: true,
      release: true,
      connect: true,
    };
    const sent = network({
      [`POST /api/v1/children/${ID}/connect/visit`]: json(200, { progress }),
    });
    expect(await children.visitConnect(ID)).toEqual(progress);
    expect(sent.map(s => `${s.method} ${s.url}`)).toEqual([
      `POST /api/v1/children/${ID}/connect/visit`,
    ]);
  });
});
