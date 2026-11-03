// A parent's children (build plan 7.4), through the generated client: only the child's
// own fields (name, age, gender, school, avatar). Journey progress is read-only here: the
// services set it (`progress.profile` once name, age and gender are all present).
// A photo is uploaded straight to S3 with avatar/presign, then saved by its `avatar_key`.

import type { components } from './generated/children';
import { services, unwrap } from './services';
import { localFile, postToS3 } from './uploads';

type Schemas = components['schemas'];

export type Child = Schemas['Child'];
export type ChildIn = Schemas['ChildIn'];
export type ChildPatch = Schemas['ChildPatch'];
export type Progress = Schemas['Progress'];
export type ChildSort = 'created_at' | '-created_at' | 'name' | '-name';

/** What children accepts for a photo; it refuses anything else when the photo is saved. */
export const AVATAR_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_LIMITS = 'JPEG, PNG, WebP or GIF, up to 5 MB';

/** Why this photo can't be used, or null when it can. */
export function avatarProblem(type: string, size: number): string | null {
  if (!AVATAR_TYPES.includes(type))
    return 'Please pick a JPEG, PNG, WebP or GIF photo.';
  if (size > AVATAR_MAX_BYTES)
    return 'That photo is over 5 MB. Please pick a smaller one.';
  return null;
}

const byId = (id: string) => ({ params: { path: { id } } });

export const children = {
  list: (sort: ChildSort = '-created_at', limit?: number): Promise<Child[]> =>
    unwrap(
      services.children.GET('/api/v1/children', {
        params: { query: { sort, limit } },
      }),
    ),
  get: (id: string): Promise<Child> =>
    unwrap(services.children.GET('/api/v1/children/{id}', byId(id))),
  create: (child: ChildIn): Promise<Child> =>
    unwrap(services.children.POST('/api/v1/children', { body: child })),
  update: (id: string, patch: ChildPatch): Promise<Child> =>
    unwrap(
      services.children.PATCH('/api/v1/children/{id}', {
        ...byId(id),
        body: patch,
      }),
    ),
  remove: async (id: string): Promise<void> => {
    await unwrap(services.children.DELETE('/api/v1/children/{id}', byId(id)));
  },

  /** Uploads `photo` to S3 and saves it as the child's avatar (replacing an emoji one). */
  async uploadAvatar(
    id: string,
    photo: Blob,
    contentType: string,
    fileUri?: string,
  ): Promise<Child> {
    const problem = avatarProblem(contentType, photo.size);
    if (problem) throw new Error(problem);
    const { upload_url, upload_fields, avatar_key } = await unwrap(
      services.children.POST('/api/v1/children/{id}/avatar/presign', {
        ...byId(id),
        body: { content_type: contentType },
      }),
    );
    // The picked file by its URI on a device (`photo` is only measured for the 5 MB check).
    await postToS3(
      upload_url,
      upload_fields,
      fileUri ? localFile(fileUri, contentType) : photo,
    );
    return children.update(id, { avatar_key });
  },

  /** Records that the parent opened Connect (build plan 7.7; children serves this until a
   *  connect service exists). Refused with `circle_locked` before Release is done. */
  visitConnect: async (id: string): Promise<Progress> =>
    (
      await unwrap(
        services.children.POST('/api/v1/children/{id}/connect/visit', byId(id)),
      )
    ).progress,
};

/** What the screens show for a refusal, matched on `detail.code`. */
export const CHILD_ERRORS: Record<string, string> = {
  child_limit:
    "You've reached the maximum of 10 children. Delete one to add another.",
  child_not_found: "That child couldn't be found.",
  child_changed: 'The profile changed meanwhile. Please try again.',
  account_deleting: 'This account is being deleted.',
  avatar_too_large: 'That photo is over 5 MB. Please pick a smaller one.',
  avatar_not_uploaded: "The photo didn't upload. Please try again.",
  unsupported_image_type: 'Please pick a JPEG, PNG, WebP or GIF photo.',
  uploads_not_configured: "Photo uploads aren't available right now.",
};
