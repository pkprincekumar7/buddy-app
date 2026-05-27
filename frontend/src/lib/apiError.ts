import { ApiError } from '@/api/errors';

interface HttpErrorOptions {
  fallback?: string;
  statusMessages?: Record<number, string>;
}

export function httpErrorMessage(
  err: ApiError | Error | null | undefined,
  { fallback = 'Something went wrong.', statusMessages = {} }: HttpErrorOptions = {},
): string {
  const status = err instanceof ApiError ? err.status : undefined;
  if (status != null) {
    const specific = statusMessages[status];
    if (specific != null) return specific;
  }
  return err?.message ?? fallback;
}
