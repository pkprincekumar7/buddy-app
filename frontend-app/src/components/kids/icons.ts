/** The kids page's star (the prototype's), in a 24×24 box. */
export const STAR_PATH =
  'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z';
/** The streak flame, in a 24×24 box. */
export const FLAME_PATH =
  'M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1 2.6 2 3 0-2.8-.3-5.5.5-8z';

/** Each power's icon (the prototype's), by its game, in a 24×24 box. */
export const POWER_ICONS: Record<string, string> = {
  focus:
    'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M12 3v3M12 18v3M3 12h3M18 12h3',
  curious:
    'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  order: 'M5 21V4M5 4h11l-2 4 2 4H5',
  draw: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  climb: 'M3 20l6-11 4 7 3-4 5 8z',
  voice:
    'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  energy: 'M13 2L4 14h7l-1 8 9-12h-7z',
};
