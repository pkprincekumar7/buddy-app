import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AVATAR_MAX_BYTES,
  avatarProblem,
  CHILD_ERRORS,
  children,
} from '@/api/children';
import { httpErrorMessage } from '@/lib/apiError';

jest.mock('@/lib/env', () => ({ env: { API_URL: 'https://api.test' } }));

type Sent = {
  method: string;
  url: string;
  type: string | null;
  body: unknown;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers every call with `answer`, and keeps what was sent. */
function network(answer: (sent: Sent) => Response): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      const type = request.headers.get('content-type');
      const text = await request.text();
      const call = {
        method: request.method,
        url: request.url.replace('https://api.test', ''),
        type,
        body: type?.includes('json') && text ? JSON.parse(text) : text,
      };
      sent.push(call);
      return answer(call);
    },
  ) as typeof fetch;
  return sent;
}

const ID = 'c0ffee00-0000-4000-8000-000000000001';
const CHILD = {
  id: ID,
  name: 'Aarav',
  age: 9,
  gender: 'Male',
  school: null,
  avatar_id: null,
  avatar_url: null,
  progress: {
    profile: true,
    conversation: false,
    discover: false,
    grow: false,
    transform: false,
    release: false,
    connect: false,
  },
  created_at: '2026-10-31T00:00:00Z',
  updated_at: '2026-10-31T00:00:00Z',
};

beforeEach(async () => {
  await AsyncStorage.setItem('superpower:access_token', 'parent-token');
});

describe('the children calls (build plan 7.4)', () => {
  it('list newest first by created_at', async () => {
    const sent = network(() => json(200, [CHILD]));
    const [first] = await children.list();
    await children.list('-created_at', 1);
    expect(sent.map(s => decodeURIComponent(s.url))).toEqual([
      '/api/v1/children?sort=-created_at',
      '/api/v1/children?sort=-created_at&limit=1',
    ]);
    expect(first?.progress.profile).toBe(true);
  });

  it('send only the profile fields on create and update', async () => {
    const sent = network(() => json(200, CHILD));
    await children.create({ name: 'Aarav', age: 9, gender: 'Male' });
    await children.update(ID, { school: null, avatar_id: 'boy-1' });
    expect(sent.map(s => [s.method, s.url, s.body])).toEqual([
      ['POST', '/api/v1/children', { name: 'Aarav', age: 9, gender: 'Male' }],
      ['PATCH', `/api/v1/children/${ID}`, { school: null, avatar_id: 'boy-1' }],
    ]);
  });

  it('upload a photo to S3, then save it by its avatar_key', async () => {
    const key = `uploads/in/${ID}/avatar/abc.png`;
    const sent = network(({ url }) =>
      url.endsWith('/avatar/presign')
        ? json(200, {
            upload_url: 'https://s3.test/bucket',
            upload_fields: {
              key,
              'Content-Type': 'image/png',
              policy: 'signed',
            },
            avatar_key: key,
            avatar_url: 'https://s3.test/bucket/get-here',
          })
        : url.startsWith('https://s3.test')
        ? new Response(null, { status: 200 })
        : json(200, {
            ...CHILD,
            avatar_url: 'https://s3.test/bucket/get-here',
          }),
    );
    const photo = new Blob(['png-bytes'], {
      type: 'image/png',
      lastModified: 0,
    });
    const saved = await children.uploadAvatar(ID, photo, 'image/png');
    expect(sent.map(s => [s.method, s.url])).toEqual([
      ['POST', `/api/v1/children/${ID}/avatar/presign`],
      ['POST', 'https://s3.test/bucket'],
      ['PATCH', `/api/v1/children/${ID}`],
    ]);
    expect(sent[0]?.body).toEqual({ content_type: 'image/png' });
    // A form upload (APP-07): the signed fields, then the file, last as S3 requires.
    expect(sent[1]?.type).toMatch(/^multipart\/form-data/);
    const form = String(sent[1]?.body);
    const order = [
      'name="key"',
      'name="Content-Type"',
      'name="policy"',
      'name="file"',
    ];
    const at = order.map(part => form.indexOf(part));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(form).toContain('png-bytes');
    expect(sent[2]?.body).toEqual({ avatar_key: key }); // the key, not the URL
    expect(saved.avatar_url).toBe('https://s3.test/bucket/get-here');
  });

  it('refuse a photo over 5 MB or of another type before any call', async () => {
    const sent = network(() => json(500, {}));
    expect(avatarProblem('image/jpeg', AVATAR_MAX_BYTES)).toBeNull();
    expect(avatarProblem('image/jpeg', AVATAR_MAX_BYTES + 1)).toMatch(/5 MB/);
    expect(avatarProblem('image/heic', 10)).toMatch(/JPEG, PNG, WebP or GIF/);
    const big = new Blob(['x'.repeat(AVATAR_MAX_BYTES + 1)], {
      type: 'image/jpeg',
      lastModified: 0,
    });
    await expect(children.uploadAvatar(ID, big, 'image/jpeg')).rejects.toThrow(
      /5 MB/,
    );
    expect(sent).toHaveLength(0);
  });

  it('show the refusals by their code', async () => {
    network(() =>
      json(422, { detail: { code: 'child_limit', msg: 'At most 10.' } }),
    );
    const refused: Error = await children.create({ name: 'Eleventh' }).then(
      () => new Error('expected a refusal'),
      (err: unknown) => err as Error,
    );
    expect(httpErrorMessage(refused, { codeMessages: CHILD_ERRORS })).toBe(
      CHILD_ERRORS.child_limit,
    );
  });

  it('delete a child by id', async () => {
    const sent = network(() => new Response(null, { status: 204 }));
    await children.remove(ID);
    expect(sent.map(s => `${s.method} ${s.url}`)).toEqual([
      `DELETE /api/v1/children/${ID}`,
    ]);
  });
});
