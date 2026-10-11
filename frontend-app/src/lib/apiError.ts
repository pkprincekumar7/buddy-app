import { ApiError } from '@/api/errors';

interface HttpErrorOptions {
  fallback?: string;
  statusMessages?: Record<number, string>;
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

export function httpErrorMessage(
  err: ApiError | Error | null | undefined,
  {
    fallback = 'Something went wrong.',
    statusMessages = {},
  }: HttpErrorOptions = {},
): string {
  const countryMessage = countryNotSupportedMessage(err);
  if (countryMessage != null) return countryMessage;
  const status = err instanceof ApiError ? err.status : undefined;
  if (status != null) {
    const specific = statusMessages[status];
    if (specific != null) return specific;
  }
  return err?.message ?? fallback;
}
