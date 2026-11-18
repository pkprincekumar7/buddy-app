/**
 * Child view's routes (docs/child-view-build-plan.md, 1.3). In child view only
 * the child's hub (the orb and the circles) and their kids page are open; every
 * other route goes back to the hub.
 */

/** The circles, as the kids page names them (its tabs, and `/Kids/:childId/:area`). */
export const KIDS_AREAS = ['discover', 'grow', 'transform', 'connect', 'release'] as const;
export type KidsArea = (typeof KIDS_AREAS)[number];

export function isKidsArea(value: string | undefined): value is KidsArea {
  return (KIDS_AREAS as readonly string[]).includes(value ?? '');
}

/** The kids page at one circle. */
export function kidsPath(childId: string, area: KidsArea): string {
  return `/Kids/${childId}/${area}`;
}

/** Where child view opens, and where a closed route sends it: the child's circles. */
export function childViewHome(childId: string): string {
  return `/PersonalityJourney/${childId}/DimensionCircles`;
}

/** Whether `pathname` may open in child view for `childId`. */
export function allowedInChildView(pathname: string, childId: string): boolean {
  const [page, id, sub, ...rest] = pathname.split('/').filter(Boolean);
  if (id !== childId || rest.length > 0) return false;
  if (page === 'PersonalityJourney') return sub === undefined || sub === 'DimensionCircles';
  if (page === 'Kids') return isKidsArea(sub);
  return false;
}
