/** Discover's powers in child view (docs/child-view-build-plan.md, 2.5): shared by both apps. */

/** How many powers the orbit holds (children's kids.POWER_COUNT). */
export const POWER_COUNT = 7;

/**
 * Each power's centre on the orbit, in percent of the orbit's box: the first at the top, the
 * rest clockwise (the prototype's 39% radius).
 */
export const POWER_SLOTS: readonly { x: number; y: number }[] = Array.from(
  { length: POWER_COUNT },
  (_, i) => {
    const angle = ((-90 + (i * 360) / POWER_COUNT) * Math.PI) / 180;
    return {
      x: Math.round((50 + 39 * Math.cos(angle)) * 10) / 10,
      y: Math.round((50 + 39 * Math.sin(angle)) * 10) / 10,
    };
  },
);

/** A power's bubble size, in percent of the orbit's box: bigger for a higher level. */
export function powerSize(level: number): number {
  return 13 + level * 1.4;
}
