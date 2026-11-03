/** A file to upload: React Native sends a local file by its URI; a Blob works too (tests). */
export type UploadFile = Blob | { uri: string; name: string; type: string };

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
