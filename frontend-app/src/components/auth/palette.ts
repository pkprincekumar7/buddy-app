/**
 * Literal colors for the auth screens that the WEB doesn't express as theme
 * tokens. On the web the "Continue with Google" button is rendered by Google
 * Identity Services (`renderButton({ theme: css('outline'), size: css('large')
 * })`), so these are GSI's own outline-theme colors and the Google "G" brand
 * colors. Values live in src/theme/tokens.mobile.js (one place for every
 * color); this file only gives them feature-local names.
 */
import { rgb } from '@/theme';
export const GOOGLE_BUTTON_BG = rgb('auth-google-button-bg');
export const GOOGLE_BUTTON_BORDER = rgb('auth-google-button-border');
export const GOOGLE_BUTTON_TEXT = rgb('auth-google-button-text');
export const GOOGLE_G_BLUE = rgb('auth-google-g-blue');
export const GOOGLE_G_GREEN = rgb('auth-google-g-green');
export const GOOGLE_G_YELLOW = rgb('auth-google-g-yellow');
export const GOOGLE_G_RED = rgb('auth-google-g-red');
