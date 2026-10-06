/**
 * Colors the web Observations page (frontend/src/pages/Observations.tsx) writes
 * as literals instead of `--x-rgb` tokens. Values live in
 * src/theme/tokens.mobile.js (one place for every color); this file only gives
 * them feature-local names.
 */
import { css, rgb } from '@/theme';

/** Step card background — web `rgba(6,10,18,.7)`. */
export const STEP_CARD_BG = rgb('observations-step-card-bg', 0.7);

/** "Start tracking" panel gradient — web `linear-gradient(165deg,rgba(10,16,28,.92),rgba(5,8,15,.92))`. */
export const CTA_PANEL_GRADIENT = css(
  'linear-gradient(165deg, rgb(var(--observations-cta-panel-gradient1-rgb) / 0.92), rgb(var(--observations-cta-panel-gradient2-rgb) / 0.92))',
);

/** "Start tracking" button label — web `#04121a`. */
export const CTA_BUTTON_TEXT = rgb('observations-cta-button-text');
