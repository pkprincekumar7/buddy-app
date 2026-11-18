import { useEffect, useState } from 'react';

/** How long a closing modal's content takes to fade out. */
const FADE_MS = 250;
/** When its Modal is taken down: just after the fade. */
const MODAL_EXIT_MS = 300;

/**
 * Whether an RN `<Modal>` should still be up: while `open`, and while its content fades out
 * after it closes. Render the content while this is true, and give it `modalFade(open)`.
 *
 * Not Reanimated's `exiting`: on Android a Modal's content leaving the tree was re-drawn a frame
 * late, and when the Modal went at the same time, over the app after it had gone, so a menu or
 * dialog vanished, came back, and faded out.
 */
export function useModalExit(open: boolean): boolean {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const id = setTimeout(() => setShown(false), MODAL_EXIT_MS);
    return () => clearTimeout(id);
  }, [open]);
  return open || shown;
}

/** A modal's content style: shown while `open`, fading out once it closes, and no longer
 *  tappable while it fades (a second tap on a menu row would act twice). */
export const modalFade = (open: boolean) => ({
  opacity: open ? 1 : 0,
  pointerEvents: open ? ('auto' as const) : ('none' as const),
  transitionProperty: 'opacity' as const,
  transitionDuration: open ? 0 : FADE_MS,
});
