/**
 * Literal colors the web PersonalityJourney page writes inline (not through a
 * `--x-rgb` variable). Named once here so no component repeats a hex; Values
 * live in src/theme/tokens.mobile.js (one place for every color); this file
 * only gives them feature-local names.
 */
import { rgb } from '@/theme';

/** Locked node inner sphere — `radial-gradient(circle at 38% 32%, #cbd6dd, …slate-deep 55%, #2a333c 100%)`. */
export const LOCKED_SPHERE_HIGHLIGHT = rgb('journey-locked-sphere-highlight');
export const LOCKED_SPHERE_SHADOW = rgb('journey-locked-sphere-shadow');
/** Locked node icon stroke. */
export const LOCKED_ICON_STROKE = rgb('journey-locked-icon-stroke');

/** Hyperspace-streak star colors (warp-enter canvas). */
export const WARP_STAR_PALETTE = [
  rgb('journey-warp-star-palette1'),
  rgb('journey-warp-star-palette2'),
  rgb('journey-warp-star-palette3'),
  rgb('journey-warp-star-palette4'),
  rgb('journey-warp-star-palette5'),
] as const;
