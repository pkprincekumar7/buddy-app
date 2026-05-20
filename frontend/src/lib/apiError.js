/**
 * Translates an API error object into a user-facing message string.
 *
 * @param {{ status?: number, message?: string } | null | undefined} err - The caught error (may have .status and .message).
 * @param {{ fallback?: string, statusMessages?: Record<number, string> }} [options]
 * @returns {string}
 */
export function httpErrorMessage(
  err,
  { fallback = 'Something went wrong.', statusMessages = {} } = {},
) {
  const specific = statusMessages[err?.status];
  if (specific != null) return specific;
  return err?.message || fallback;
}
