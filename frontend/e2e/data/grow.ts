// A stand-in for the grow service's growth areas (backend/grow), so a parent-view Grow test
// can answer, save and generate: a save keeps the area's answers, a generation is a job
// that ends as the test says (`outcome`), and a completed one writes its part, as grow
// does: the parent questions, or the recommendations (which complete the area, current
// against the child's latest run of its world).

import type { Call, Stubs } from '../fixtures';
import { aJob, anArea } from './builders';
import type { GrowSchemas } from './routes';

type Area = GrowSchemas['schemas']['Area'];
type Kind = 'parent_questions' | 'recommendations';
type Recommendation = GrowSchemas['schemas']['Recommendation'];

export interface GrowServerOptions {
  /** How a job answers its `poll`-th poll (1-based); `attempt` is which generation of that
   *  kind it is (1 for the first, 2 for a Try again). Default: processing, then completed. */
  outcome?: (kind: Kind, poll: number, attempt: number) => 'processing' | 'completed' | 'failed';
  /** What a completed recommendations job writes. */
  recommendations?: Recommendation[];
  /** The child's latest run of each area's world, which recommendations are written from. */
  latestRunAt?: string | null;
}

export class GrowServer {
  readonly areas = new Map<string, Area>();
  // Each job: its kind and area, its polls so far, and which attempt of its kind it is.
  private readonly jobs = new Map<
    string,
    { kind: Kind; areaId: string; polls: number; n: number }
  >();
  private started = 0;

  constructor(
    initial: Area[],
    private readonly options: GrowServerOptions = {},
  ) {
    for (const a of initial) this.areas.set(a.area_id, structuredClone(a));
  }

  /** The number of generations of `kind` started. */
  startedOf(kind: Kind): number {
    return [...this.jobs.values()].filter((j) => j.kind === kind).length;
  }

  private area(areaId: string, name?: string | null): Area {
    let a = this.areas.get(areaId);
    if (!a) {
      a = anArea({
        area_id: areaId,
        area_name: name ?? areaId,
        status: 'in_progress',
        parent_questions: null,
        completed_at: null,
      });
      this.areas.set(areaId, a);
    }
    return a;
  }

  private finish(kind: Kind, areaId: string): void {
    const a = this.area(areaId);
    if (kind === 'parent_questions') {
      a.parent_questions = anArea().parent_questions
        ? JSON.parse(JSON.stringify(anArea().parent_questions).replaceAll('life_ambition', areaId))
        : null;
      return;
    }
    a.ai_three_month_recommendations = this.options.recommendations ?? [];
    a.recommendations_current = true;
    a.recommendations_run_at = this.options.latestRunAt ?? null;
    a.status = 'completed';
    a.completed_at = '2026-11-16T00:00:00Z';
  }

  stubs(): Stubs {
    const outcome =
      this.options.outcome ??
      ((_k: Kind, poll: number) => (poll >= 2 ? 'completed' : 'processing'));
    return {
      'GET /children/{id}/growth-areas': () => ({
        body: { areas: [...this.areas.values()].map((a) => structuredClone(a)) },
      }),
      'PUT /children/{id}/growth-areas/{area_id}': ({ params, body }: Call) => {
        const areaId = params['area_id'] ?? '';
        const input = body as Partial<Area>;
        const a = this.area(areaId, input.area_name);
        Object.assign(a, {
          area_name: input.area_name ?? a.area_name,
          status: input.status ?? a.status,
          step: input.step ?? a.step,
          answers: input.answers ?? a.answers,
          // New answers make the recommendations stale, as grow says.
          recommendations_current: input.answers ? false : a.recommendations_current,
        });
        return { body: structuredClone(a) };
      },
      'POST /children/{id}/growth-areas/{area_id}/generation': ({ params, body }: Call) => {
        const { kind, area_name } = body as { kind: Kind; area_name?: string };
        this.area(params['area_id'] ?? '', area_name);
        this.started += 1;
        const id = `job-${this.started}`;
        this.jobs.set(id, {
          kind,
          areaId: params['area_id'] ?? '',
          polls: 0,
          n: this.startedOf(kind) + 1,
        });
        return { status: 202, body: { job_id: id, status: 'pending' } };
      },
      'GET /children/{id}/growth-areas/{area_id}/generation/{job_id}': ({ params }: Call) => {
        const id = params['job_id'] ?? '';
        const job = this.jobs.get(id);
        if (!job) return { status: 404, body: { detail: { code: 'job_not_found' } } };
        job.polls += 1;
        const status = outcome(job.kind, job.polls, job.n);
        if (status === 'completed') this.finish(job.kind, job.areaId);
        return { body: aJob(job.kind, status, id) };
      },
    };
  }
}
