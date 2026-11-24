/** Routes that are publicly accessible without authentication. */
export const PUBLIC_AUTH_PATHS = ['/Login', '/Register'] as const;

export const isPublicAuthPath = (path: string): boolean =>
  (PUBLIC_AUTH_PATHS as readonly string[]).includes(path);

/**
 * Where to go after signing in: the page the person was sent away from (`from`, in the sign-in
 * page's location state), when it's one of this app's own pages, else `fallback`. Only a
 * plain in-app path is followed: never another site ("//…", a scheme) or a sign-in page.
 */
export function afterSignIn(state: unknown, fallback: string): string {
  const from = state && typeof state === 'object' ? (state as { from?: unknown }).from : undefined;
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return fallback;
  if (from.includes('\\') || isPublicAuthPath(from)) return fallback;
  return from;
}
