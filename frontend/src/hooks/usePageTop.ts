import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * An element's top on the page (below the app bar, and the Back row when there is one), kept up
 * to date on every render and on resize: the element may appear after the hook's first render (a
 * page showing its loader first, the journey's hub phase), or move. Things meant to sit on the
 * window's centre (the journey's orb and hub, the page loaders' spinner) go at 50vh less this.
 * Layout offsets, not getBoundingClientRect: the journey's screens measure while their entrance
 * animations are still scaling them.
 */
export function usePageTop(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [top, setTop] = useState(fallback);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    let y = 0;
    for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) {
      y += e.offsetTop;
    }
    setTop(y); // the same value bails out, so measuring each render doesn't loop
  }, [ref]);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);
  return top;
}
