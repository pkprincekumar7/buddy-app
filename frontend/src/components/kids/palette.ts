import type { CSSProperties } from 'react';
import type { KidsArea } from '@/lib/childView';
import type { KidsColor } from '@/lib/kidsMoods';

/**
 * The kids page's colour variables (docs/child-view-build-plan.md "Theming"): every colour is
 * an index.css --kids-* token; these only point the page's and a tile's variables at them.
 */

/** The six pairs Discover's powers cycle through (power i takes POWER_COLORS[i % 6]). */
export const POWER_COLORS: readonly KidsColor[] = [
  'discover',
  'teal',
  'transform',
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

/** A tile's own pair (a mood, a power), read by .kids-tile. */
export function tileVars(color: KidsColor): CSSProperties {
  return {
    '--kids-tile-rgb': `var(--kids-${color}-rgb)`,
    '--kids-tile-shade-rgb': `var(--kids-${color}-shade-rgb)`,
  } as CSSProperties;
}

/** A tile's colour for an SVG stroke or fill. */
export function tileColor(color: KidsColor): string {
  return `rgb(var(--kids-${color}-rgb))`;
}
