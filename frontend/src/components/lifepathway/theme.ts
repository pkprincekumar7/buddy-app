/**
 * Style constants shared by every step of StartJourneyModal
 * (Ask/Plan/Payment/Done/Dashboard/Tracker) — kept in one place so the six
 * step views read as one consistent surface rather than six independently
 * styled screens.
 */

export const GOLD = 'rgb(var(--constellation-gold-rgb))';
export const GOLD_PALE = 'rgb(var(--constellation-gold-pale-rgb))';
export const CYAN = 'rgb(var(--constellation-cyan-rgb))';
export const INK = 'rgb(var(--constellation-navy-rgb))';
export const BODY = 'rgb(var(--constellation-slate-warm-rgb))';
export const LABEL_CL = 'rgb(var(--constellation-slate-mute-rgb))';
export const FROST = 'rgb(var(--constellation-text-frost-rgb))';

export const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 7,
  padding: '12px 14px',
  borderRadius: 10,
  background: 'rgb(var(--constellation-navy-deepest-rgb) / .85)',
  border: '1px solid rgb(var(--constellation-cyan-rgb) / .2)',
  color: FROST,
  fontWeight: 700,
  fontSize: 15.5,
  outline: 'none',
};

export const FIELD_LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontWeight: 700,
  fontSize: 10.5,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  color: LABEL_CL,
};

export const PRIMARY_BTN: React.CSSProperties = {
  cursor: 'pointer',
  padding: '14px 32px',
  borderRadius: 999,
  border: 'none',
  background: `linear-gradient(135deg,${CYAN},${GOLD})`,
  color: INK,
  fontWeight: 900,
  fontSize: 12.5,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  boxShadow: '0 0 30px rgb(var(--constellation-cyan-rgb) / .35)',
};
