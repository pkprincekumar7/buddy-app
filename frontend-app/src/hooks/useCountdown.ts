import { useEffect, useRef, useState } from 'react';

/** Seconds left of `seconds`, ticking every 100 ms; `onEnd` runs once at zero. */
export function useCountdown(seconds: number, onEnd: () => void): number {
  const [left, setLeft] = useState(seconds);
  const end = useRef(onEnd);
  useEffect(() => {
    end.current = onEnd;
  });
  useEffect(() => {
    const started = Date.now();
    let fired = false;
    const id = setInterval(() => {
      const remaining = Math.max(0, seconds - (Date.now() - started) / 1000);
      setLeft(remaining);
      if (remaining <= 0 && !fired) {
        fired = true;
        clearInterval(id);
        end.current();
      }
    }, 100);
    return () => clearInterval(id);
  }, [seconds]);
  return left;
}
