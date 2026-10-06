/**
 * Color literals the WEB PersonalityProfile page
 * (frontend/src/pages/PersonalityProfile.tsx) hardcodes inline rather than
 * reading from a `--x-rgb` token. Named here once so no component repeats a
 * literal; Values live in src/theme/tokens.mobile.js (one place for every
 * color); this file only gives them feature-local names.
 */
import { rgb } from '@/theme';
export const PP = {
  /** SEC_LABEL text color. */
  secLabel: rgb('profile-sec-label'),
  /** CARD_BG gradient top stop. */
  cardBgTop: rgb('profile-card-bg-top', 0.55),
  /** TraitIcon ring border. */
  traitIconBorder: rgb('profile-trait-icon-border', 0.35),
  /** TraitIcon disc fill. */
  traitIconBg: rgb('profile-trait-icon-bg', 0.55),
  /** Reveal backdrop radial glow + its transparent end + linear bottom stop. */
  revealGlow: rgb('profile-reveal-glow', 0.55),
  revealGlowEnd: rgb('profile-reveal-glow-end', 0),
  revealBottom: rgb('profile-reveal-bottom'),
  /** Reveal badge gradient top, outer blue glow, sweep highlight, title text glow. */
  badgeBgTop: rgb('profile-badge-bg-top', 0.7),
  badgeGlow: rgb('profile-badge-glow', 0.45),
  badgeSweep: rgb('profile-badge-sweep', 0.65),
  badgeTitleGlow: rgb('profile-badge-title-glow', 0.9),
  /** Profile wrapper radial glows (top / bottom). */
  wrapperGlowTop: rgb('profile-wrapper-glow-top', 0.55),
  wrapperGlowBottom: rgb('profile-wrapper-glow-bottom', 0.45),
  /** Header title text glow; meta line color. */
  headerTitleGlow: rgb('profile-header-title-glow', 0.75),
  headerMeta: rgb('profile-header-meta'),
  /** Avatar ring gradient stops. */
  avatarRing1: rgb('profile-avatar-ring1'),
  avatarRing2: rgb('profile-avatar-ring2'),
  avatarRing3: rgb('profile-avatar-ring3'),
  /** Initials fallback radial-gradient highlight. */
  initialsGlow: rgb('profile-initials-glow', 0.5),
  /** Score bar track + fill gradient stops. */
  barTrack: rgb('profile-bar-track', 0.7),
  barFill1: rgb('profile-bar-fill1'),
  barFill2: rgb('profile-bar-fill2'),
  barFill3: rgb('profile-bar-fill3'),
  /** Thinker card background + caption color. */
  thinkerBg: rgb('profile-thinker-bg', 0.7),
  thinkerCaption: rgb('profile-thinker-caption'),
  /** Own-words quote text; parent note text; "Replay the reveal" link. */
  quoteText: rgb('profile-quote-text'),
  parentNote: rgb('profile-parent-note'),
  replayLink: rgb('profile-replay-link'),
} as const;
