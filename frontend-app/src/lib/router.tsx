/**
 * router — a thin react-router-compatible facade over React Navigation.
 *
 * The web app navigates with URL paths (`navigate('/GrowthAreas/abc')`,
 * `navigate(-1)`, `navigate('/Home', { replace: true })`) and reads
 * `useParams()` / `useLocation()` / `useSearchParams()`. Ported code keeps
 * exactly those calls: this module parses the path into a stack route
 * (`GrowthAreas` with `{ childId: 'abc' }`) and drives the root stack through
 * `navigationRef`, so it works both inside screens and in providers that sit
 * outside any screen (AuthContext, AmbientAudioProvider).
 *
 * Path grammar (mirrors web App.tsx's routes):
 *   /                              → Home
 *   /<Page>                        → Page
 *   /<Page>/<childId>              → Page { childId }
 *   /<Page>/<childId>/<sub…>       → Page { childId, sub }   (e.g. PersonalityJourney …/DimensionCircles)
 *   /GrowthAreas/<id>/Activity/…   → GrowthAreas { childId }  (web redirects these stale links to the map)
 *   ?a=1&b=2                       → params.search ('a=1&b=2')
 *   { state }                      → params.state
 */
import React, {
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { type PressableProps } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import {
  CommonActions,
  NavigationRouteContext,
  StackActions,
  createNavigationContainerRef,
} from '@react-navigation/native';

export const PAGE_NAMES = [
  'Home',
  'Onboarding',
  'ConversationalOnboarding',
  'PersonalityJourney',
  'PersonalityProfile',
  'LifePathway',
  'GrowthAreas',
  'Observations',
  'Connect',
  'Admin',
  'Login',
  'Register',
  'NotFound',
] as const;
export type PageName = (typeof PAGE_NAMES)[number];

export interface RouteParams {
  childId?: string;
  /** Path segments after the childId, joined with '/' (e.g. 'DimensionCircles'). */
  sub?: string;
  /** Raw query string without the leading '?'. */
  search?: string;
  /** react-router `location.state` equivalent. */
  state?: unknown;
}

export type RootStackParamList = { [K in PageName]: RouteParams | undefined };

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// ─── Current-route store (for code outside a screen) ─────────────────────────

interface CurrentRoute {
  name: PageName;
  params: RouteParams;
}
let current: CurrentRoute = { name: 'Home', params: {} };
const listeners = new Set<() => void>();

/** Wire to NavigationContainer's onReady + onStateChange. */
export function syncCurrentRoute(): void {
  if (!navigationRef.isReady()) return;
  const r = navigationRef.getCurrentRoute();
  if (!r) return;
  const next: CurrentRoute = {
    name: (r.name as PageName) ?? 'Home',
    params: (r.params as RouteParams | undefined) ?? {},
  };
  if (next.name === current.name && next.params === current.params) return;
  current = next;
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ─── Path <-> route ──────────────────────────────────────────────────────────

const PAGE_SET = new Set<string>(PAGE_NAMES);

export function parsePath(to: string): { name: PageName; params: RouteParams } {
  const [pathPart = '', search] = to.split('?');
  const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const [page, childId, ...rest] = segs;
  const name: PageName = !page
    ? 'Home'
    : PAGE_SET.has(page)
    ? (page as PageName)
    : 'NotFound';
  const params: RouteParams = {};
  if (childId) params.childId = childId;
  // Stale /GrowthAreas/:id/Activity/... links all land on the map (web App.tsx).
  if (rest.length && name !== 'GrowthAreas') params.sub = rest.join('/');
  if (search) params.search = search;
  return { name, params };
}

export function buildPath(name: PageName, params: RouteParams = {}): string {
  const parts = [name, params.childId, params.sub].filter(Boolean).join('/');
  return `/${parts}${params.search ? `?${params.search}` : ''}`;
}

// ─── Imperative navigation ───────────────────────────────────────────────────

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}
export type NavigateFunction = (
  to: string | number,
  options?: NavigateOptions,
) => void;

function routeExists(name: PageName): boolean {
  const state = navigationRef.getRootState();
  return !!state?.routeNames.includes(name);
}

/**
 * Navigate from anywhere. A target that isn't mounted in the current auth tree
 * (e.g. `/Login` while signed in, or `/Home` while signed out) is ignored —
 * the root navigator swaps screen sets itself when auth state changes, exactly
 * like the web AppShell re-rendering a different <Routes> block.
 */
export const navigate: NavigateFunction = (to, options = {}) => {
  if (!navigationRef.isReady()) return;
  if (typeof to === 'number') {
    if (to < 0 && navigationRef.canGoBack()) navigationRef.goBack();
    return;
  }
  const { name, params } = parsePath(to);
  if (options.state !== undefined) params.state = options.state;
  if (!routeExists(name)) return;
  if (options.replace) {
    if (name === 'Home') {
      // Replacing onto Home resets the stack — Home is the root of the app.
      navigationRef.dispatch(
        CommonActions.reset({ index: 0, routes: [{ name, params }] }),
      );
    } else {
      navigationRef.dispatch(StackActions.replace(name, params));
    }
  } else {
    // push (not navigate) so the same page with a different child stacks like
    // a new history entry, matching browser history semantics.
    navigationRef.dispatch(StackActions.push(name, params));
  }
};

// ─── Hooks (react-router API) ────────────────────────────────────────────────

export function useNavigate(): NavigateFunction {
  return useCallback<NavigateFunction>(
    (to, options) => navigate(to, options),
    [],
  );
}

/** The enclosing screen's route, or the globally-focused route outside a screen. */
function useActiveRoute(): CurrentRoute {
  const screenRoute = useContext(NavigationRouteContext);
  const global = useSyncExternalStore(subscribe, () => current);
  if (screenRoute) {
    return {
      name: screenRoute.name as PageName,
      params: (screenRoute.params as RouteParams | undefined) ?? {},
    };
  }
  return global;
}

export interface Location {
  pathname: string;
  search: string;
  state: unknown;
}

export function useLocation(): Location {
  const { name, params } = useActiveRoute();
  return useMemo(
    () => ({
      pathname: buildPath(name, { childId: params.childId, sub: params.sub }),
      search: params.search ? `?${params.search}` : '',
      state: params.state ?? null,
    }),
    [name, params],
  );
}

export function useParams<
  T extends Record<string, string | undefined> = { childId?: string },
>(): T {
  const { params } = useActiveRoute();
  return useMemo(
    () => ({ childId: params.childId, sub: params.sub } as unknown as T),
    [params],
  );
}

/** Minimal URLSearchParams stand-in (RN's polyfill does not implement get()). */
export class SearchParams {
  private entries: [string, string][];
  constructor(search = '') {
    this.entries = search
      .replace(/^\?/, '')
      .split('&')
      .filter(Boolean)
      .map(pair => {
        const [k = '', v = ''] = pair.split('=');
        return [
          decodeURIComponent(k),
          decodeURIComponent(v.replace(/\+/g, ' ')),
        ];
      });
  }
  get(key: string): string | null {
    return this.entries.find(([k]) => k === key)?.[1] ?? null;
  }
  has(key: string): boolean {
    return this.entries.some(([k]) => k === key);
  }
  set(key: string, value: string): void {
    this.entries = this.entries.filter(([k]) => k !== key);
    this.entries.push([key, value]);
  }
  delete(key: string): void {
    this.entries = this.entries.filter(([k]) => k !== key);
  }
  toString(): string {
    return this.entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }
}

export function useSearchParams(): [
  SearchParams,
  (next: SearchParams | Record<string, string>) => void,
] {
  const { params } = useActiveRoute();
  const sp = useMemo(() => new SearchParams(params.search), [params.search]);
  const setSearch = useCallback(
    (next: SearchParams | Record<string, string>) => {
      const str =
        next instanceof SearchParams
          ? next.toString()
          : Object.entries(next)
              .map(
                ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
              )
              .join('&');
      if (navigationRef.isReady()) {
        navigationRef.dispatch(
          CommonActions.setParams({ search: str || undefined }),
        );
      }
    },
    [],
  );
  return [sp, setSearch];
}

// ─── Components ──────────────────────────────────────────────────────────────

/** `<Link to="/Register">` — a Pressable that navigates on press. */
export function Link({
  to,
  replace,
  children,
  onPress,
  ...rest
}: Omit<PressableProps, 'children'> & {
  to: string;
  replace?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={e => {
        onPress?.(e);
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

/** `<Navigate to=… replace />` — navigates once on mount. */
export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  React.useEffect(() => {
    navigate(to, { replace });
  }, [to, replace]);
  return null;
}
