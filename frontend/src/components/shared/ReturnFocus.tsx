import { useEffect, useRef, useState } from 'react';

/**
 * Put inside a dialog: when the dialog goes away, focus goes back to what had it when the
 * dialog opened (the button that opened it), so a keyboard user isn't left on the page with
 * nothing focused. Radix only does this for its own Trigger; most dialogs here open from
 * state. Nothing happens when focus has moved on deliberately (outside the dialog), or when
 * the opener is gone (the page changed).
 */
export default function ReturnFocus() {
  // Read while rendering: the dialog's own focus move runs in an effect, after this.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const dialog = marker.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    return () => {
      // After the dialog's exit (and Radix's own close handling) has run.
      requestAnimationFrame(() => {
        if (!opener?.isConnected || opener === document.body) return;
        const active = document.activeElement;
        const lost =
          !active || active === document.body || !active.isConnected || !!dialog?.contains(active);
        if (lost) opener.focus();
      });
    };
  }, [opener]);

  return <span ref={marker} hidden />;
}
