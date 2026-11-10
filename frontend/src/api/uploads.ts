/**
 * Uploads `file` with a presigned S3 form (production-readiness review, APP-07): the fields
 * the API signed first, then the file as `file`, which S3 requires last. The signed policy
 * pins the key and the Content-Type and limits the size to 5 MB, so S3 refuses anything else.
 */
export async function postToS3(
  url: string,
  fields: Record<string, string>,
  file: Blob,
): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append('file', file);
  const uploaded = await fetch(url, { method: 'POST', body: form });
  if (!uploaded.ok) throw new Error(`The photo upload failed (${uploaded.status}).`);
}
