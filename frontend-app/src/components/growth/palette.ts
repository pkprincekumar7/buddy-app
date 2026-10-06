/**
 * Literal colors the web Growth Map writes inline rather than through a
 * `--x-rgb` token. Named once here so no component repeats the literal; Values
 * live in src/theme/tokens.mobile.js (one place for every color); this file
 * only gives them feature-local names.
 */
import { rgb } from '@/theme';

/** web GrowthAreas nebula wash vignette edge: `rgba(2,3,9,.82)`. */
export const GROWTH_VIGNETTE = rgb('growth-growth-vignette', 0.82);
