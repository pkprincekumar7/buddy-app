/**
 * Colors the web LifePathway page (frontend/src/pages/LifePathway.tsx) writes
 * inline as literals rather than through a `--x-rgb` token. Named once here so
 * no component repeats them; Values live in src/theme/tokens.mobile.js (one
 * place for every color); this file only gives them feature-local names.
 */
import { rgb } from '@/theme';
export const LP_PALETTE = {
  /** Root background, third radial layer: rgba(160,120,255,.10). */
  violetGlow: rgb('lifepath-violet-glow', 0.1),
  /** Superpower card gradient start: rgba(52,40,18,.85). */
  superCardFrom: rgb('lifepath-super-card-from', 0.85),
  /** Superpower card gradient end: rgba(12,17,28,.9). */
  superCardTo: rgb('lifepath-super-card-to', 0.9),
  /** Superpower card body text: #e0cba8. */
  superCardBody: rgb('lifepath-super-card-body'),
  /** Growth-area <option> background: #08101c. */
  optionBg: rgb('lifepath-option-bg'),
  /** Chart node fill: #fff3d6. */
  nodeFill: rgb('lifepath-node-fill'),
  /** Gap caption sub-line: rgba(200,222,234,.6). */
  gapCaption: rgb('lifepath-gap-caption', 0.6),
  /** Inactive age label: #5f7688. */
  ageLabel: rgb('lifepath-age-label'),
  /** Routine-life milestone body text: #7f95a5. */
  routineBody: rgb('lifepath-routine-body'),
  /** Compare superpower card gradient start: rgba(28,52,80,.9). */
  compareFrom: rgb('lifepath-compare-from', 0.9),
  /** Compare superpower card gradient end: rgba(40,32,16,.75). */
  compareTo: rgb('lifepath-compare-to', 0.75),
  /** Compare superpower card body text: #eddfc6. */
  compareSuperBody: rgb('lifepath-compare-super-body'),
  /** Compare routine card body text: #7c91a1. */
  compareRoutineBody: rgb('lifepath-compare-routine-body'),
  /** 90-day move row text: #c8dae5. */
  moveText: rgb('lifepath-move-text'),
} as const;
