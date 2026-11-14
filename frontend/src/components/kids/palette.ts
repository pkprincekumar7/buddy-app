import type { CSSProperties } from 'react';
import type { KidsArea } from '@/lib/childView';
import type { KidsColor } from '@/lib/kidsMoods';

/**
 * The kids page's colour variables (docs/child-view-build-plan.md "Theming"): every colour is
 * an index.css --kids-* token; these only point the page's and a tile's variables at them.
 */

/** The kids palette's six pairs in the prototype's order (cyan, gold, teal, pink, violet,
 * orange): Transform's interests and quests and Connect's wins take them in turn. */
export const KIDS_COLORS: readonly KidsColor[] = [
  'discover',
  'transform',
  'teal',
  'connect',
  'release',
  'orange',
];

/** The open circle's pair, read by .kids-btn, .kids-card, bg-kids-area… below the page root. */
export function areaVars(area: KidsArea): CSSProperties {
  return {
    '--kids-area-rgb': `var(--kids-${area}-rgb)`,
    '--kids-area-shade-rgb': `var(--kids-${area}-shade-rgb)`,
  } as CSSProperties;
}

/** A pair of the kids palette: the circles' and powers' colours, and Grow's gold. */
export type KidsPair = KidsColor | 'gold';

/** A tile's own pair (a mood, a power), read by .kids-tile. */
export function tileVars(color: KidsPair): CSSProperties {
  return {
    '--kids-tile-rgb': `var(--kids-${color}-rgb)`,
    '--kids-tile-shade-rgb': `var(--kids-${color}-shade-rgb)`,
  } as CSSProperties;
}

/** A tile's colour for an SVG stroke or fill. */
export function tileColor(color: KidsPair): string {
  return `rgb(var(--kids-${color}-rgb))`;
}
