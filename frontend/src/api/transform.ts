// Transform, the Life Pathway and the 90-day plan (build plan 7.7), through the
// generated client. One GET returns everything the circle shows: the completed growth
// areas with their Life Pathway milestones, and the plan with its tracker. Transform
// writes the generated parts itself (milestones per area, the plan, the tracker) from
// prompts it builds: the app asks for a `kind` and polls the job. Photos are saved by
// their S3 keys. Setting the Day-90 event on a finished plan makes Transform done.

import type { components } from './generated/transform';
import { runJob, type PollOptions } from './polling';
import { services, unwrap } from './services';
import { postToS3 } from './uploads';

type Schemas = components['schemas'];

export type TransformDoc = Schemas['Transform'];
export type TransformArea = Schemas['AreaView'];
export type PlanPatch = Omit<Schemas['PlanPatch'], 'clear_track_steps'> & {
  clear_track_steps?: boolean;
};
export type TransformKind = Schemas['GenerationIn']['kind'];
export type PlanPhoto = Schemas['Photo'];

const byId = (id: string) => ({ params: { path: { id } } });

export const transform = {
  get: (childId: string): Promise<TransformDoc> =>
    unwrap(services.transform.GET('/api/v1/children/{id}/transform', byId(childId))),
  /** Each field sent replaces the stored one; a `photos` key replaces that key's list. */
  patch: (childId: string, patch: PlanPatch): Promise<TransformDoc> =>
    unwrap(
      services.transform.PATCH('/api/v1/children/{id}/transform', {
        ...byId(childId),
        body: { clear_track_steps: false, ...patch },
      }),
    ),
  /** Starts a generation, or returns the one already running for that kind (and area). */
  generate: (childId: string, kind: TransformKind, areaId?: string) =>
    unwrap(
      services.transform.POST('/api/v1/children/{id}/transform/generation', {
        ...byId(childId),
        body: { kind, ...(areaId === undefined ? {} : { area_id: areaId }) },
      }),
    ),
  job: (childId: string, jobId: string) =>
    unwrap(
      services.transform.GET('/api/v1/children/{id}/transform/generation/{job_id}', {
        params: { path: { id: childId, job_id: jobId } },
      }),
    ),

  /**
   * Uploads a plan photo to S3 for `fieldKey`, and returns its key (to save in
   * `photos[fieldKey]` with the others) and a short-lived URL to show it at once.
   */
  async uploadPhoto(
    childId: string,
    fieldKey: string,
    photo: Blob,
    contentType: string,
  ): Promise<PlanPhoto> {
    const { upload_url, upload_fields, photo_key, photo_url } = await unwrap(
      services.transform.POST('/api/v1/children/{id}/transform/photos/presign', {
        ...byId(childId),
        body: { field_key: fieldKey, content_type: contentType },
      }),
    );
    await postToS3(upload_url, upload_fields, photo);
    return { key: photo_key, url: photo_url };
  },
};

/** Runs one generation to its end: starts it (or joins the one running) and polls its job. */
export function runTransformGeneration(
  childId: string,
  kind: TransformKind,
  { areaId, ...options }: { areaId?: string } & PollOptions = {},
): Promise<'completed' | 'failed'> {
  return runJob(
    () => transform.generate(childId, kind, areaId),
    (jobId) => transform.job(childId, jobId),
    options,
  );
}

/** What the Transform screens show for a refusal, matched on `detail.code`. */
export const TRANSFORM_ERRORS: Record<string, string> = {
  circle_locked: 'Complete a growth area first, then come back.',
  plan_changed: 'The plan changed meanwhile. Please try again.',
  plan_too_large: 'That’s too much to save. Please shorten your notes.',
  needs_ask: 'Tell us what to focus on first.',
  needs_plan: 'The plan isn’t ready yet.',
  needs_event: 'Set the Day-90 event first.',
  needs_completed_area: 'Complete this growth area first.',
  invalid_photo_key: 'That photo couldn’t be saved. Please try again.',
  photo_not_uploaded: 'The photo didn’t upload. Please try again.',
  photo_too_large: 'That photo is over 5 MB. Please pick a smaller one.',
  unsupported_image_type:
    'That photo format isn’t supported. Try a JPEG, PNG, WEBP or GIF instead.',
  uploads_not_configured: 'Photo uploads aren’t available right now.',
  llm_limit: 'Lots of requests right now. Please try again in a little while.',
  generation_paused: 'Generating is paused for a little while. Please try again later.',
  generation_unavailable: 'We couldn’t start that just now. Please try again.',
};
