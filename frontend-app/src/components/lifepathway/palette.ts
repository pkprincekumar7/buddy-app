/**
 * Literal colors the WEB StartJourneyModal writes inline (not theme tokens):
 * the card-network marks in the checkout's "Card information" box — fixed
 * third-party brand colors, exactly as on the web. Kept here once by name;
 * Values live in src/theme/tokens.mobile.js (one place for every color); this
 * file only gives them feature-local names.
 */
import { rgb } from '@/theme';
export const VISA_BLUE = rgb('journey-modal-visa-blue');
export const MASTERCARD_RED = rgb('journey-modal-mastercard-red');
export const MASTERCARD_ORANGE = rgb('journey-modal-mastercard-orange');
export const AMEX_BLUE = rgb('journey-modal-amex-blue');
export const CARD_MARK_TEXT = rgb('journey-modal-card-mark-text');
