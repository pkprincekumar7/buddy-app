import { test as base, expect, type Page, type Request } from '@playwright/test';
import type { BodyOf, RouteKey } from './data/routes';
import { scenarios, type ScenarioName } from './data/scenarios';
import { CHILD_ID, USER_ID } from './data/builders';
import { GrowServer } from './data/grow';
import { KidServer } from './data/kid';
import { TransformServer } from './data/transform';

/**
 * The stubbed API (docs/web-ui-test-plan.md, section 5). Every /api/v1 request is answered
 * from `api.stubs`, keyed by the spec's route ("GET /children/{id}/kids"), so the real web
 * app runs with no backend and writes nothing real. A test starts from a scenario
 * (`api.use('childWithPlan')`, default `everythingDone`) and changes only what it needs. A
 * request no stub answers fails the test in teardown, naming the route.
 */

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 501 | 502 | 503;

/** A success reply typed by its route, or an error reply with any body. */
export type Reply<K extends RouteKey> =
  | { status?: 200 | 201 | 202 | 204; body: BodyOf<K> }
  | { status: ErrorStatus; body?: unknown };

/** What a handler sees of the request. `count` is this route's 1-based call number. */
export interface Call {
  key: RouteKey;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  count: number;
}

export type Handler<K extends RouteKey> = (call: Call) => Reply<K> | Promise<Reply<K>>;
export type Stub<K extends RouteKey> = Reply<K> | Handler<K>;
export type Stubs = { [K in RouteKey]?: Stub<K> };

interface Matcher {
  key: RouteKey;
  method: string;
  segments: string[];
  placeholders: number;
}

function matcherOf(key: RouteKey): Matcher {
  const [method = '', path = ''] = key.split(' ');
  const segments = path.split('/').slice(1);
  return {
    key,
    method,
    segments,
    placeholders: segments.filter((s) => s.startsWith('{')).length,
  };
}

/** The route a request is for, and its path parameters; literal segments win over `{x}`. */
function match(
  matchers: Matcher[],
  method: string,
  path: string,
): { key: RouteKey; params: Record<string, string> } | undefined {
  const parts = path.split('/').slice(1);
  for (const m of matchers) {
    if (m.method !== method || m.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = m.segments.every((seg, i) => {
      const part = decodeURIComponent(parts[i] ?? '');
      if (seg.startsWith('{')) {
        params[seg.slice(1, -1)] = part;
        return part !== '';
      }
      return seg === part;
    });
    if (ok) return { key: m.key, params };
  }
  return undefined;
}

function bodyOf(request: Request): unknown {
  try {
    return request.postDataJSON() as unknown;
  } catch {
    return request.postData(); // FormData (speech upload) or text
  }
}

export class Api {
  stubs: Stubs;
  /** Requests answered, in order. */
  readonly calls: Call[] = [];
  /** Requests no stub answered, "METHOD /path". */
  readonly missing: string[] = [];
  private readonly counts = new Map<string, number>();
  private matchers: Matcher[] | undefined;

  constructor(stubs: Stubs) {
    this.stubs = stubs;
  }

  /** Replace every stub with a scenario's (section 5.3). */
  use(name: ScenarioName): this {
    this.stubs = scenarios[name]();
    this.matchers = undefined;
    return this;
  }

  set<K extends RouteKey>(key: K, stub: Stub<K>): this {
    (this.stubs as Record<string, unknown>)[key] = stub;
    this.matchers = undefined;
    return this;
  }

  /** The stub currently answering `key` (to wrap it). */
  get<K extends RouteKey>(key: K): Stub<K> | undefined {
    return (this.stubs as Record<string, Stub<K> | undefined>)[key];
  }

  /** Child view's activity from `initial`, changed by each event as the server does. */
  kids(initial?: ConstructorParameters<typeof KidServer>[0]): KidServer {
    const server = new KidServer(initial);
    Object.assign(this.stubs, server.stubs());
    this.matchers = undefined;
    return server;
  }

  /** Parent-view Grow from `areas`: saves kept, generations as jobs (data/grow.ts). */
  grow(...args: ConstructorParameters<typeof GrowServer>): GrowServer {
    const server = new GrowServer(...args);
    Object.assign(this.stubs, server.stubs());
    this.matchers = undefined;
    return server;
  }

  /** Life Pathway's plan document (data/transform.ts): saves merged, generations as jobs. */
  transform(...args: ConstructorParameters<typeof TransformServer>): TransformServer {
    const server = new TransformServer(...args);
    Object.assign(this.stubs, server.stubs());
    this.matchers = undefined;
    return server;
  }

  /** `key` answers `status` from now on. */
  fail(key: RouteKey, status: ErrorStatus = 500, detail: unknown = 'Something went wrong'): this {
    return this.set(key, { status, body: { detail } });
  }

  /** `key` fails once, then answers as before (for Try again). */
  failOnce<K extends RouteKey>(
    key: K,
    status: ErrorStatus = 500,
    detail: unknown = 'Something went wrong',
  ): this {
    const before = this.get(key);
    let failed = false;
    return this.set(key, async (call) => {
      if (!failed) {
        failed = true;
        return { status, body: { detail } };
      }
      return resolve(before, call);
    });
  }

  /** 403 circle_locked, as a service answers for a circle not yet open. */
  locked(key: RouteKey): this {
    return this.fail(key, 403, { code: 'circle_locked', msg: 'Finish the earlier circles first.' });
  }

  notFound(key: RouteKey): this {
    return this.fail(key, 404, { code: 'child_not_found', msg: 'Child not found' });
  }

  /** Hold `key`'s reply for `ms`, to see its loading state. */
  slow<K extends RouteKey>(key: K, ms: number): this {
    const before = this.get(key);
    return this.set(key, async (call) => {
      await new Promise((r) => setTimeout(r, ms));
      return resolve(before, call);
    });
  }

  /** The next call to `key` gets 401; the refresh succeeds and the retry is answered. */
  expireSession<K extends RouteKey>(key: K): this {
    const before = this.get(key);
    let expired = false;
    this.set('POST /auth/refresh', { body: { status: 'ok' } });
    return this.set(key, async (call) => {
      if (!expired) {
        expired = true;
        return { status: 401, body: { detail: 'Not authenticated' } };
      }
      return resolve(before, call);
    });
  }

  /** `key` gets 401 and the refresh is refused too: the session ends. */
  endSession(key: RouteKey = 'GET /auth/me'): this {
    this.set('POST /auth/refresh', { status: 401, body: { detail: 'Not authenticated' } });
    return this.fail(key, 401, 'Not authenticated');
  }

  /** `key` gets 401 and the refresh says the account is locked. */
  lockAccount(key: RouteKey = 'GET /auth/me', msg = 'This account is locked.'): this {
    this.set('POST /auth/refresh', {
      status: 403,
      body: { detail: { code: 'account_locked', msg } },
    });
    return this.fail(key, 401, 'Not authenticated');
  }

  /** The calls made to `key`, in order. */
  callsTo(key: RouteKey): Call[] {
    return this.calls.filter((c) => c.key === key);
  }

  /** The bodies the app sent to `key`, in order. */
  sent(key: RouteKey): unknown[] {
    return this.callsTo(key).map((c) => c.body);
  }

  /** Put the browser in child view for the test child (lib/ViewModeContext's storage). */
  async childView(page: Page, childId = CHILD_ID): Promise<void> {
    await page.addInitScript(
      ([userId, id]) =>
        localStorage.setItem('superpower.view', JSON.stringify({ userId, childId: id })),
      [USER_ID, childId],
    );
  }

  async install(page: Page): Promise<void> {
    // Nothing leaves the machine: any other host is refused unless a test stubs it
    // (stubGoogle, stubUploads; routes added later take precedence).
    await page.route(
      (url) => url.hostname !== '127.0.0.1',
      (route) => route.abort('blockedbyclient'),
    );
    // The avatar videos and images: a failed one ends its splash at once (StageSplash).
    await page.route('**/app-assets/**', (route) => route.abort());
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/v1/, '');
      this.matchers ??= (Object.keys(this.stubs) as RouteKey[])
        .map(matcherOf)
        .sort((a, b) => a.placeholders - b.placeholders);
      const found = match(this.matchers, request.method(), path);
      if (!found) {
        this.missing.push(`${request.method()} ${path}`);
        await route.fulfill({
          status: 501,
          json: { detail: `no stub for ${request.method()} ${path}` },
        });
        return;
      }
      const count = (this.counts.get(found.key) ?? 0) + 1;
      this.counts.set(found.key, count);
      const call: Call = {
        key: found.key,
        path,
        params: found.params,
        query: url.searchParams,
        body: bodyOf(request),
        count,
      };
      this.calls.push(call);
      const reply = await resolve(this.get(found.key), call);
      if (reply.status === 204) {
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ status: reply.status ?? 200, json: reply.body ?? null });
    });
  }
}

async function resolve<K extends RouteKey>(
  stub: Stub<K> | undefined,
  call: Call,
): Promise<Reply<K>> {
  if (!stub) return { status: 501, body: { detail: `no stub for ${call.key}` } };
  return typeof stub === 'function' ? stub(call) : stub;
}

interface Fixtures {
  api: Api;
  /** Console errors and uncaught exceptions on the page (ALL-05). */
  consoleErrors: string[];
}

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));
    page.on('console', (msg) => {
      // The aborted /app-assets/ media and blocked hosts (Api.install) log a failed load.
      if (msg.type() === 'error' && !/net::ERR_(FAILED|BLOCKED_BY_CLIENT)/.test(msg.text()))
        errors.push(msg.text());
    });
    await use(errors);
  },
  // Automatic: a test that never names `api` still gets the stubbed API, so nothing it
  // does reaches the dev server's proxy.
  api: [
    async ({ page }, use, testInfo) => {
      const coverage = !!process.env['COVERAGE'];
      if (coverage) await page.coverage.startJSCoverage({ resetOnNavigation: false });
      const api = new Api(scenarios.everythingDone());
      await api.install(page);
      await use(api);
      if (coverage) {
        const entries = await page.coverage.stopJSCoverage();
        const { addCoverageReport } = await import('monocart-reporter');
        await addCoverageReport(entries, testInfo);
      }
      expect(api.missing, 'requests with no stub (add them to the scenario or the test)').toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

export { expect };
