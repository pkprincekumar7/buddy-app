import { useState, useCallback } from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

import { RotateCcw, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogPortal,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useStartOver } from '@/hooks/useStartOver';
import { MODAL_BACKDROP, MODAL_SCALE } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { START_OVER_DESCRIPTION } from '@/lib/startOverCopy';

interface ConfirmModalProps {
  onCancel: () => void;
  onConfirm: () => void;
  isStartingOver: boolean;
  /** Defaults to the Start Over copy; the profile menu's delete passes its own. */
  title?: string;
  description?: string;
}

export function ConfirmModal({
  onCancel,
  onConfirm,
  isStartingOver,
  title = 'Start Over?',
  description = START_OVER_DESCRIPTION,
}: ConfirmModalProps) {
  // Radix AlertDialog supplies Escape, focus move/trap/restore and the
  // accessible name/description; the motion divs keep the original visuals.
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogPortal>
        <AlertDialogPrimitive.Overlay asChild>
          <motion.div {...MODAL_BACKDROP} className="modal-overlay" onClick={onCancel}>
            {/* Not asChild: AlertDialog.Content marks its children with a Slottable whose
                symbol is private to each copy of @radix-ui/react-slot, and this tree has
                several, so with asChild the inner Slot doesn't recognise it and throws
                "React.Children.only expected to receive a single React element child". */}
            <AlertDialogPrimitive.Content
              className="w-full max-w-sm outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              <motion.div
                {...MODAL_SCALE}
                className="border-edge-strong w-full rounded-2xl bg-surface-elevated p-8"
              >
                {/* Icon */}
                <div className="mb-5 flex justify-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-error-medium/30 bg-error-medium/10">
                    <AlertTriangle className="h-7 w-7 text-error" />
                  </div>
                </div>

                {/* Text */}
                <div className="mb-7 space-y-2 text-center">
                  <AlertDialogTitle className="text-lg font-bold text-foreground">
                    {title}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </AlertDialogDescription>
                  <p className="text-xs font-medium text-error">This cannot be undone.</p>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <Button
                    onClick={onConfirm}
                    disabled={isStartingOver}
                    className="h-11 flex-1 rounded-xl bg-error-strong text-base text-white hover:bg-error-medium disabled:opacity-50"
                  >
                    {isStartingOver ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Deleting…
                      </span>
                    ) : (
                      'Yes, delete'
                    )}
                  </Button>
                  <AlertDialogPrimitive.Cancel asChild>
                    <Button
                      variant="outline"
                      disabled={isStartingOver}
                      className="btn-secondary h-11 flex-1 rounded-xl text-base"
                    >
                      Cancel
                    </Button>
                  </AlertDialogPrimitive.Cancel>
                </div>
              </motion.div>
            </AlertDialogPrimitive.Content>
          </motion.div>
        </AlertDialogPrimitive.Overlay>
      </AlertDialogPortal>
    </AlertDialog>
  );
}

interface StartOverButtonProps {
  childId?: string;
  className?: string;
}

export default function StartOverButton({ childId, className = '' }: StartOverButtonProps) {
  const { doStartOver, isStartingOver } = useStartOver(childId);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    void doStartOver();
  }, [doStartOver]);

  const handleCancel = useCallback(() => setConfirming(false), []);

  return (
    <>
      <Button
        size="xl"
        variant="outline"
        onClick={() => childId && setConfirming(true)}
        disabled={isStartingOver || !childId}
        className={cn('btn-start-over rounded-2xl', className)}
      >
        <RotateCcw className="mr-1 h-4 w-4" />
        {isStartingOver ? 'Resetting…' : 'Start Over'}
      </Button>

      <AnimatePresence>
        {confirming && (
          <ConfirmModal
            onCancel={handleCancel}
            onConfirm={handleConfirm}
            isStartingOver={isStartingOver}
          />
        )}
      </AnimatePresence>
    </>
  );
}
