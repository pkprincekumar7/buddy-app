// Shared Framer Motion animation presets — spread directly onto <motion.*> elements.
// e.g. <motion.div {...slideUp(0.2)} /> or <motion.div {...SPINNER} />

export const SPINNER = {
  animate: { rotate: 360 },
  transition: { duration: 2, repeat: Infinity, ease: 'linear' },
};

export const FADE_IN = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.6, ease: 'easeOut' },
};

// Horizontal slide used for wizard phase transitions.
export const PAGE_SLIDE = {
  initial: { opacity: 0, x: 50 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -50 },
  transition: { duration: 0.45 },
};

export const MODAL_BACKDROP = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.3 },
};

export const MODAL_SCALE = {
  initial: { opacity: 0, scale: 0.95, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 16 },
  transition: { duration: 0.375, ease: 'easeOut' },
};

// Returns vertical slide-up animation props with an optional delay.
export function slideUp(delay = 0, duration = 1.0) {
  return {
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration, delay, ease: 'easeOut' },
  };
}
