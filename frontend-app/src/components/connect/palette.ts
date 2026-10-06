/**
 * Literal colors the WEB Connect page writes inline (not via a `--x-rgb`
 * token). Named here once so no component repeats the literal. Values are
 * verbatim from frontend/src/pages/Connect.tsx and
 * frontend/src/components/connect/*. Values live in src/theme/tokens.mobile.js
 * (one place for every color); this file only gives them feature-local names.
 */
import { rgb } from '@/theme';

// Connect.tsx
export const IG_SHARE_TILE_FROM = rgb('connect-ig-share-tile-from', 0.85);
export const TW_SHARE_TILE_FROM = rgb('connect-tw-share-tile-from', 0.85);
export const TW_RING_OVER = rgb('connect-tw-ring-over');

// shared.tsx
export const IG_BG_PLUM_FROM = rgb('connect-ig-bg-plum-from');
export const IG_BG_PLUM_TO = rgb('connect-ig-bg-plum-to');
export const IG_BG_SEA_FROM = rgb('connect-ig-bg-sea-from');
export const IG_BG_SEA_TO = rgb('connect-ig-bg-sea-to');
export const IG_BG_GOLD_TO = rgb('connect-ig-bg-gold-to');
export const SHIELD_DEFAULT = rgb('connect-shield-default');
export const TOAST_BG = rgb('connect-toast-bg', 0.95);
export const TOAST_SHADOW = rgb('connect-toast-shadow', 0.8);

// AccomplishmentCards.tsx
export const CARD_PREVIEW_SHADOW = rgb('connect-card-preview-shadow', 0.75);
export const ROW_ACTIVE_FROM = rgb('connect-row-active-from', 0.9);
export const ROW_ACTIVE_TO = rgb('connect-row-active-to', 0.8);

// WhatsAppModal.tsx
export const WA_PANEL_FROM = rgb('connect-wa-panel-from', 0.97);
export const WA_PANEL_TO = rgb('connect-wa-panel-to', 0.97);
export const WA_PANEL_SHADOW = rgb('connect-wa-panel-shadow', 0.8);
export const WA_DONE_BG = rgb('connect-wa-done-bg', 0.8);

// TwitterModal.tsx
export const TW_BACKDROP_INNER = rgb('connect-tw-backdrop-inner', 0.72);
export const TW_BACKDROP_OUTER = rgb('connect-tw-backdrop-outer', 0.94);
export const TW_PANEL_FROM = rgb('connect-tw-panel-from', 0.97);
export const TW_PANEL_TO = rgb('connect-tw-panel-to', 0.97);
export const TW_PANEL_SHADOW = rgb('connect-tw-panel-shadow', 0.8);
export const TW_BADGE_FROM = rgb('connect-tw-badge-from', 0.95);
export const TW_DONE_BG = rgb('connect-tw-done-bg', 0.8);

// InstagramModal.tsx
export const IG_BACKDROP_INNER = rgb('connect-ig-backdrop-inner', 0.72);
export const IG_BACKDROP_OUTER = rgb('connect-ig-backdrop-outer', 0.94);
export const IG_PANEL_FROM = rgb('connect-ig-panel-from', 0.97);
export const IG_PANEL_TO = rgb('connect-ig-panel-to', 0.97);
export const IG_PANEL_SHADOW = rgb('connect-ig-panel-shadow', 0.8);
export const IG_BADGE_FROM = rgb('connect-ig-badge-from', 0.95);
export const IG_CTA_MID = rgb('connect-ig-cta-mid');
export const IG_STORY_CARD_SHADOW = rgb('connect-ig-story-card-shadow', 0.6);
export const IG_DONE_BG = rgb('connect-ig-done-bg', 0.8);
