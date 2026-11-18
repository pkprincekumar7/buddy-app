// A stand-in for the transform service's plan document (backend/transform), so a Life
// Pathway test can save and generate: each PATCH merges into the document and moves its
// version on, a generation is a job that ends as the test says, and a completed one writes
// its part: the 90-day plan (the app's own built-in plan for the interest, so it parses as
// a generated one does), the event tracker, or an area's Life Pathway milestones.

import { getPlan, readInterest } from '../../src/lib/startJourneyPlans';
import type { Call, Stubs } from '../fixtures';
import { aJob, aTransform } from './builders';
import type { TransformSchemas } from './routes';

type Doc = TransformSchemas['schemas']['Transform'];
type Area = TransformSchemas['schemas']['AreaView'];
type Kind = 'life_pathway' | 'plan' | 'event_tracker';

export interface TransformServerOptions {
  /** How a job answers its `poll`-th poll; `attempt` is which generation of its kind it is. */
  outcome?: (kind: Kind, poll: number, attempt: number) => 'processing' | 'completed' | 'failed';
}

/** The Life Pathway's slots (a year ahead, two, three, five, eight, ten). */
const SLOTS = ['y1', 'y2', 'y3', 'y5', 'y8', 'y10'] as const;

/** An area's milestones as a life_pathway job stores them: a title per slot that names it. */
export function someMilestones(label: string): Record<string, unknown> {
  return Object.fromEntries(
    SLOTS.map((slot) => [
      slot,
      {
        title: `${label} milestone ${slot}`,
        guided: `What the guided path looks like at ${slot}.`,
        power: 'What Superpower does to get there.',
        drift: 'What happens on the routine path instead.',
      },
    ]),
  );
}

/** A completed growth area as transform returns it (its milestones, if any, stored). */
export const aTransformArea = (over: Partial<Area> = {}): Area => ({
  area_id: 'life_ambition',
  area_name: 'Life Ambition',
  recommendations: null,
  ai_three_month_recommendations: null,
  life_pathway_milestones: null,
  life_pathway_generating: false,
  ...over,
});

const MERGED = [
  'applied',
  'act_inputs',
  'act_counts',
  'track_done',
  'track_inputs',
  'track_sittings',
  'feedback',
] as const;

export class TransformServer {
  doc: Doc;
  /** Every PATCH body, in order. */
  readonly patches: Record<string, unknown>[] = [];
  private readonly jobs = new Map<
    string,
    { kind: Kind; polls: number; attempt: number; area?: string }
  >();

  constructor(
    initial: Partial<Doc> = {},
    private readonly options: TransformServerOptions = {},
  ) {
    // A copy: a test's areas and plan are shared constants, and the jobs write into these.
    this.doc = structuredClone(aTransform(initial));
  }

  startedOf(kind: Kind): number {
    return [...this.jobs.values()].filter((j) => j.kind === kind).length;
  }

  /** The areas life_pathway jobs were started for, in order. */
  get pathwayAreas(): (string | undefined)[] {
    return [...this.jobs.values()].filter((j) => j.kind === 'life_pathway').map((j) => j.area);
  }

  /** Another device saves `change` (as a PATCH would), so the page's version is now old. */
  otherDevice(change: Record<string, unknown>): void {
    this.patch(change);
  }

  private patch(body: Record<string, unknown>): Doc {
    const d = this.doc;
    for (const key of MERGED) {
      const part = body[key];
      if (part && typeof part === 'object') Object.assign(d[key], part);
    }
    for (const key of ['ask', 'event_name', 'event_date', 'event_set'] as const) {
      if (body[key] !== undefined) (d as Record<string, unknown>)[key] = body[key];
    }
    const photos = body['photos'] as Record<string, string[]> | undefined;
    if (photos)
      for (const [field, keys] of Object.entries(photos))
        d.photos[field] = keys.map((key) => ({ key, url: `https://uploads.example.test/${key}` }));
    if (body['clear_track_steps']) d.track_steps = null;
    d.version += 1;
    return structuredClone(d);
  }

  private finish(kind: Kind, areaId?: string): void {
    if (kind === 'life_pathway') {
      const area = this.doc.areas.find((a) => a.area_id === areaId);
      if (area) {
        area.life_pathway_milestones = someMilestones(`Generated ${area.area_name}`);
        area.life_pathway_generating = false;
      }
    }
    if (kind === 'plan')
      this.doc.plan = getPlan(readInterest(this.doc.ask ?? '')) as unknown as Doc['plan'];
    if (kind === 'event_tracker') this.doc.track_steps = { steps: [] };
    this.doc.generating = this.doc.generating.filter((k) => k !== kind);
  }

  stubs(): Stubs {
    const outcome =
      this.options.outcome ??
      ((_k: Kind, poll: number) => (poll >= 2 ? 'completed' : 'processing'));
    return {
      'GET /children/{id}/transform': () => ({ body: structuredClone(this.doc) }),
      'PATCH /children/{id}/transform': ({ body }: Call) => {
        const patch = body as Record<string, unknown>;
        this.patches.push(patch);
        if (patch['version'] !== this.doc.version)
          return {
            status: 409,
            body: { detail: { code: 'plan_changed', msg: 'The plan changed meanwhile.' } },
          };
        return { body: this.patch(patch) };
      },
      'POST /children/{id}/transform/generation': ({ body }: Call) => {
        const { kind, area_id: area } = body as { kind: Kind; area_id?: string };
        const id = `job-${this.jobs.size + 1}`;
        this.jobs.set(id, { kind, polls: 0, attempt: this.startedOf(kind) + 1, area });
        this.doc.generating = [...new Set([...this.doc.generating, kind])];
        // No plan yet (version 0): the job makes one at version 1, as the service's
        // target_on_insert does, so a page still on version 0 is now old.
        if (this.doc.version === 0) this.doc.version = 1;
        return { status: 202, body: { job_id: id, status: 'pending' } };
      },
      'GET /children/{id}/transform/generation/{job_id}': ({ params }: Call) => {
        const id = params['job_id'] ?? '';
        const job = this.jobs.get(id);
        if (!job) return { status: 404, body: { detail: { code: 'job_not_found' } } };
        job.polls += 1;
        const status = outcome(job.kind, job.polls, job.attempt);
        if (status === 'completed') this.finish(job.kind, job.area);
        if (status === 'failed')
          this.doc.generating = this.doc.generating.filter((k) => k !== job.kind);
        return { body: aJob(job.kind, status, id) };
      },
    };
  }
}

/** The plan the app builds for `ask` (what a completed plan job stores here). */
export const planFor = (ask: string) => getPlan(readInterest(ask));
