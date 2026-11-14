/**
 * The profile button and menu's styles: the web's `.profile-*` and
 * `.avatar-dot-*` classes in frontend/src/index.css, from the same tokens.
 * Shared by AppHeader and ProfileChildren.
 */
import type { TextStyle, ViewStyle } from 'react-native';
import { css, font, rgb } from '@/theme';

/** `.avatar-dot-parent`: the parent's gold dot. */
export const PARENT_DOT = css(
  'radial-gradient(circle at 35% 30%, rgb(var(--constellation-gold-cream2-rgb)), rgb(var(--constellation-gold-rgb)) 55%, rgb(var(--profile-parent-deep-rgb)))',
);
/** `.avatar-dot-child`: a child's cyan dot. */
export const CHILD_DOT = css(
  'radial-gradient(circle at 35% 30%, rgb(var(--constellation-cyan-pale-rgb)), rgb(var(--constellation-cyan-rgb)) 55%, rgb(var(--constellation-cyan-deep-rgb)))',
);

/** `.profile-pill`: the header button. */
export const PILL: ViewStyle = {
  backgroundColor: rgb('profile-pill', 0.75),
  borderWidth: 1,
  borderColor: rgb('profile-pill-border'),
};
/** `.profile-pill:hover`, as the pressed state. */
export const PILL_PRESSED: ViewStyle = {
  borderColor: rgb('constellation-cyan', 0.45),
};

/** `.profile-panel`: the dropdown. */
export const PANEL: ViewStyle = {
  backgroundColor: rgb('constellation-overlay', 0.96),
  borderWidth: 1,
  borderColor: rgb('constellation-cyan', 0.2),
  borderRadius: 14,
  boxShadow: css('0 20px 60px rgb(var(--constellation-void-deep-rgb) / 0.7)'),
};

/** `.profile-row-selected`. */
export const ROW_SELECTED: ViewStyle = {
  backgroundColor: rgb('constellation-cyan', 0.1),
};
/** `.profile-row:hover`, as the pressed state. */
export const ROW_PRESSED: ViewStyle = {
  backgroundColor: rgb('constellation-cyan', 0.08),
};
/** `.profile-divider`. */
export const DIVIDER: ViewStyle = {
  borderTopWidth: 1,
  borderTopColor: rgb('constellation-cyan', 0.1),
  marginHorizontal: 4,
  marginVertical: 6,
};

const LABEL_SIZE = 9.5;
/** `.profile-label`: the small uppercase view label. */
export const LABEL: TextStyle = {
  ...font('rajdhani', 700),
  fontSize: LABEL_SIZE,
  letterSpacing: LABEL_SIZE * 0.16,
  textTransform: 'uppercase',
  color: rgb('constellation-slate-warm'),
};
/** `.profile-heading`. */
export const HEADING: TextStyle = {
  ...LABEL,
  color: rgb('constellation-slate-mute'),
};
/** `.profile-name`. */
export const NAME: TextStyle = {
  ...font('rajdhani', 700),
  fontSize: 14,
  color: rgb('constellation-text-frost'),
};
/** `.profile-desc`. */
export const DESC: TextStyle = {
  ...font('rajdhani', 600),
  fontSize: 12,
  color: rgb('constellation-slate-warm'),
};
/** `.profile-link`: Home, Account settings, Sign out, Add Child. */
export const LINK: TextStyle = {
  ...font('rajdhani', 600),
  fontSize: 14,
  color: rgb('constellation-slate-warm'),
};
/** `.profile-name-current`: the open child's name. */
export const NAME_CURRENT: TextStyle = {
  color: rgb('constellation-cyan'),
};
/** `.profile-row-action`: the row's edit and delete icons. */
export const ACTION_ICON = rgb('constellation-slate-warm');
/** `.profile-row-action:hover`, as the pressed state. */
export const ACTION_PRESSED: ViewStyle = {
  backgroundColor: rgb('constellation-cyan', 0.12),
};
/** `.profile-link-active`. */
export const LINK_ACTIVE = rgb('constellation-cyan');
export const LINK_COLOR = rgb('constellation-slate-warm');
/** `.avatar-dot` text. */
export const DOT_TEXT: TextStyle = {
  ...font('orbitron', 900),
  color: rgb('constellation-navy'),
};
