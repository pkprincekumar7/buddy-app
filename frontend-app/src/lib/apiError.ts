import { ApiError } from '@/api/errors';

interface HttpErrorOptions {
  fallback?: string;
  statusMessages?: Record<number, string>;
  codeMessages?: Record<string, string>;
}

/**
 * The backend's 403 for a blocked registration country and the WAF's geo-block
 * 403 (infra-live-edge/terraform/waf.tf) share the body
 * `{"detail": {"code": "country_not_supported", "msg": "..."}}`. Returns that
 * message, so callers' generic per-status text (e.g. Register's 403 "email not
 * authorized") never masks it.
 */
function countryNotSupportedMessage(
  err: ApiError | Error | null | undefined,
): string | undefined {
  if (!(err instanceof ApiError) || typeof err.detail !== 'object')
    return undefined;
  if (err.detail.code !== 'country_not_supported') return undefined;
  const msg = err.detail.msg;
  return typeof msg === 'string'
    ? msg
    : 'This service is not available in your country.';
}

/** The service's own message: `detail.msg`, or a 422's first problem (build plan 7.2). */
function serviceMessage(
  err: ApiError | Error | null | undefined,
): string | undefined {
  if (!(err instanceof ApiError) || typeof err.detail !== 'object')
    return undefined;
  const msg = err.detail.msg;
  if (typeof msg === 'string') return msg;
  const errors = err.detail.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first: unknown = errors[0];
    const text =
      first && typeof first === 'object'
        ? (first as { msg?: unknown }).msg
        : undefined;
    // pydantic prefixes a validator's own message with "Value error, ".
    if (typeof text === 'string') return text.replace(/^Value error, /, '');
  }
  return undefined;
}

/**
 * The message to show for a failed call. In order: a blocked country; `codeMessages` for
 * the service's `detail.code` (match on codes, not text); `statusMessages` by status; the
 * service's own message; a plain-text detail; then `fallback`.
 */
export function httpErrorMessage(
  err: ApiError | Error | null | undefined,
  {
    fallback = 'Something went wrong.',
    statusMessages = {},
    codeMessages = {},
  }: HttpErrorOptions = {},
): string {
  const countryMessage = countryNotSupportedMessage(err);
  if (countryMessage != null) return countryMessage;
  if (err instanceof ApiError) {
    const byCode = err.code != null ? codeMessages[err.code] : undefined;
    if (byCode != null) return byCode;
    const byStatus = statusMessages[err.status];
    if (byStatus != null) return byStatus;
    const fromService = serviceMessage(err);
    if (fromService != null) return fromService;
    return typeof err.detail === 'string' ? err.detail : fallback;
  }
  return err?.message ?? fallback;
}
