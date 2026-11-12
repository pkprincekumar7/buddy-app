import { useEffect, useRef } from 'react';

/** Calls `onWin` the first time `done` is true, and never again for this game. */
export function useWinOnce(done: boolean, onWin: () => void) {
  const won = useRef(false);
  const latest = useRef(onWin);
  useEffect(() => {
    latest.current = onWin;
  });
  useEffect(() => {
    if (done && !won.current) {
      won.current = true;
      latest.current();
    }
  }, [done]);
}
