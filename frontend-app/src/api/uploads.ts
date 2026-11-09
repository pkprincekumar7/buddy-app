/** A file to upload: React Native sends a local file by its URI; a Blob works too (tests). */
export type UploadFile = Blob | { uri: string; name: string; type: string };

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * A picked photo's real content type, from the file the picker wrote rather than the type it
 * reports. iPhones (and many Android phones) take HEIC photos, which the API refuses; the
 * pickers are asked to convert them to JPEG, but Android's picker then still reports the
 * source's `image/heic` for its `.jpeg` file. A file still in a refused format keeps its
 * reported type, so the size/type check names it.
 */
export function pickedImageType(
  uri: string,
  reported: string | null | undefined,
): string {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri)?.[1]?.toLowerCase();
  return (ext && TYPE_BY_EXTENSION[ext]) || reported || 'image/jpeg';
}

/** The form part for a picked file: React Native reads `uri` and streams the file itself. */
export function localFile(uri: string, contentType: string): UploadFile {
  const ext = contentType.split('/')[1] ?? 'jpg';
  return { uri, name: `photo.${ext}`, type: contentType };
}

/**
 * Uploads `file` with a presigned S3 form (production-readiness review, APP-07): the fields
 * the API signed first, then the file as `file`, which S3 requires last. The signed policy
 * pins the key and the Content-Type and limits the size to 5 MB, so S3 refuses anything else.
 */
export async function postToS3(
  url: string,
  fields: Record<string, string>,
  file: UploadFile,
): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  // React Native's FormData takes the { uri, name, type } object as a file part.
  form.append('file', file as Blob);
  const uploaded = await fetch(url, { method: 'POST', body: form });
  if (!uploaded.ok)
    throw new Error(`The photo upload failed (${uploaded.status}).`);
}
